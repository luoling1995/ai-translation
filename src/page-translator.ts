// 整页翻译核心模块：文本收集、分批、翻译、MutationObserver 动态翻译

import type { TranslateItem, OriginalTextRecord, TranslateBatchResponse } from './types';
import { safeSendMessageToBackground, isContextInvalidated } from './messaging';
import {
  showProgressUI, updateProgress, showAutoTranslateStatus,
  finishProgress, markCancelled, showNoContentMessage,
  removeProgressUI
} from './progress-ui';

// ==========================================
// 状态
// ==========================================

let isPageTranslating = false;
let isPageTranslated = false;
let cancelled = false;

// 原文备份，恢复时使用
let originalTexts: OriginalTextRecord[] = [];
// 被修改了 height 的容器备份，恢复时还原
interface OverflowFix { el: HTMLElement; origHeight: string; origMinHeight: string; }
let overflowFixes: OverflowFix[] = [];
// 已翻译节点 → 译文映射，防重复和防自身循环
let translatedNodeTexts = new WeakMap<Node, string>();
// 原文 → 译文缓存，SPA / 虚拟滚动场景下复用
const textTranslationCache = new Map<string, string>();

// MutationObserver 相关
let mutationObserver: MutationObserver | null = null;
let pendingNewNodes: TranslateItem[] = [];
let debounceTimer: number | null = null;
const DEBOUNCE_DELAY = 2000; // 2秒防抖，等新内容加载完再一次性翻译
let isAutoTranslating = false;

// 分批上限：5k token。
// 模型最大输入 16k、最大输出 16k；按"中英 token 1:1"的最坏情况，
// 单批输入 X + 单批输出 X + 固定开销 0.5k ≤ 16k → X ≤ 7.5k。
// 取 5k 留出 ~34% 余量，覆盖所有真实页面（包括中英 token 接近 1:1 的术语密集页），
// 彻底避免 finish_reason=length 截断。
const MAX_BATCH_TOKENS = 5000;

// 整页翻译并发数：3 路并行提速，避免触发 API QPS 限制
const CONCURRENCY_LIMIT = 3;

/** 通用并发执行器：限制同时运行的任务数，超出排队等待 */
async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const workerCount = Math.min(limit, tasks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < tasks.length) {
      const idx = cursor++;
      results[idx] = await tasks[idx]();
    }
  });
  await Promise.all(workers);
  return results;
}

// ==========================================
// 对外接口
// ==========================================

/** 获取当前翻译状态 */
export function getPageState(): { isPageTranslating: boolean; isPageTranslated: boolean } {
  return { isPageTranslating, isPageTranslated };
}

/** 执行整页翻译 */
export async function startPageTranslation(): Promise<void> {
  if (isPageTranslating) {
    console.log('[PageTranslator] 整页翻译正在运行中，跳过');
    return;
  }

  // 如果已翻译过，先恢复原文再重新翻译
  if (isPageTranslated) {
    restoreOriginalText();
  }

  isPageTranslating = true;
  cancelled = false;

  // 1. 收集所有待翻译文本节点
  const items = collectTextNodesFromElement(document.body);
  console.log('[PageTranslator] 收集到', items.length, '个待翻译文本节点');

  if (items.length === 0) {
    console.log('[PageTranslator] 页面无需翻译，全部被过滤');
    showNoContentMessage();
    isPageTranslating = false;
    return;
  }

  // 2. 优先从缓存应用，剩余的走 API
  originalTexts = [];
  const itemsToTranslate: TranslateItem[] = [];

  for (const item of items) {
    saveOriginalText(item.textNode, item.originalText);
    const cached = textTranslationCache.get(item.originalText);
    if (cached) {
      applyCachedTranslation(item.textNode, item.originalText, cached);
    } else {
      itemsToTranslate.push(item);
    }
  }

  const cacheHitCount = items.length - itemsToTranslate.length;
  if (cacheHitCount > 0) {
    console.log('[PageTranslator] 缓存命中', cacheHitCount, '个，需 API 翻译', itemsToTranslate.length, '个');
  }

  // 全部命中缓存
  if (itemsToTranslate.length === 0) {
    console.log('[PageTranslator] 全部命中缓存，无需调用 API');
    showProgressUI({
      onCancel: () => {},
      onRestore: () => restoreOriginalText()
    });
    finishProgress(false);
    updateProgress(1, 1, '✓ 翻译完成（已使用本地缓存）');
    isPageTranslating = false;
    isPageTranslated = true;
    startMutationObserver();
    return;
  }

  // 3. 分批
  const batches = splitIntoBatches(itemsToTranslate);
  const total = batches.length;
  console.log(`[PageTranslator] 分为 ${total} 批，共 ${itemsToTranslate.length} 个文本节点`);

  // 4. 显示进度条
  showProgressUI({
    onCancel: () => { cancelled = true; },
    onRestore: () => restoreOriginalText()
  });
  updateProgress(0, total);

  if (total > 50) {
    updateProgress(0, total, `正在翻译... (0/${total}) - 页面较长，预计耗时约一分钟`);
  }

  // 5. 并发翻译（每批失败最多重试 2 次，共 3 次尝试；用完成数更新进度）
  const MAX_RETRY = 2;
  let hasError = false;
  let completed = 0;
  // 待写入 DOM 的批次计数：setTimeout 异步写 DOM 必须在 startMutationObserver 前完成，
  // 否则 Observer 会把刚写入的译文当作"新增节点"重新翻译
  let pendingDomWrites = 0;
  // 收集各批次中模型丢失的项，等全部批次完成后统一补翻译
  const missedItems: TranslateItem[] = [];

  const tasks = batches.map((batch, i) => async () => {
    if (cancelled || isContextInvalidated()) {
      completed++;
      return;
    }

    const texts = batch.map(item => item.originalText);
    let batchSuccess = false;

    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      if (cancelled || isContextInvalidated()) break;

      if (attempt > 0) {
        console.log(`[PageTranslator] 批次 ${i + 1} 第 ${attempt} 次重试...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      try {
        const response: TranslateBatchResponse = await safeSendMessageToBackground({
          action: 'translateBatch',
          texts,
          batchIndex: i,
          totalBatches: total
        });

        if (cancelled || isContextInvalidated()) break;

        if (response.success) {
          const translated = response.translatedTexts;
          // 异步写 DOM，避开 React 等框架的协调器（与 applyCachedTranslation 行为一致）
          pendingDomWrites++;
          setTimeout(() => {
            for (let j = 0; j < batch.length; j++) {
              if (translated[j] !== undefined) {
                batch[j].textNode.textContent = translated[j];
                translatedNodeTexts.set(batch[j].textNode, translated[j]);
                textTranslationCache.set(batch[j].originalText, translated[j]);
              }
            }
            pendingDomWrites--;
          }, 0);
          // 收集模型丢失的项
          if (response.missedIndices && response.missedIndices.length > 0) {
            for (const idx of response.missedIndices) {
              missedItems.push(batch[idx]);
            }
          }
          console.log(`[PageTranslator] 批次 ${i + 1}/${total} 翻译成功，${batch.length} 段${response.missedIndices ? `（丢失 ${response.missedIndices.length} 项待补）` : ''}${attempt > 0 ? `（第 ${attempt + 1} 次尝试）` : ''}`);
          batchSuccess = true;
          break;
        } else {
          console.warn(`[PageTranslator] 批次 ${i + 1} 第 ${attempt + 1} 次尝试失败:`, response.error);
        }
      } catch (e) {
        console.error(`[PageTranslator] 批次 ${i + 1} 第 ${attempt + 1} 次尝试异常:`, e);
        if (isContextInvalidated()) break;
      }
    }

    if (!batchSuccess && !cancelled && !isContextInvalidated()) {
      hasError = true;
      console.warn(`[PageTranslator] 批次 ${i + 1} 重试 ${MAX_RETRY} 次后仍失败，跳过`);
    }

    completed++;
    if (!cancelled && !isContextInvalidated()) {
      updateProgress(completed, total);
    }
  });

  await runWithConcurrency(tasks, CONCURRENCY_LIMIT);

  // 等待所有 setTimeout 写 DOM 完成
  while (pendingDomWrites > 0) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  // 6. 统一补翻译：所有批次中模型丢失的项合成一批补发
  if (missedItems.length > 0 && !cancelled && !isContextInvalidated()) {
    console.log(`[PageTranslator] 补翻译 ${missedItems.length} 个丢失项`);
    try {
      const missedTexts = missedItems.map(item => item.originalText);
      const retryResponse: TranslateBatchResponse = await safeSendMessageToBackground({
        action: 'translateBatch',
        texts: missedTexts,
        batchIndex: 0,
        totalBatches: 1
      });
      if (retryResponse.success) {
        pendingDomWrites++;
        setTimeout(() => {
          for (let j = 0; j < missedItems.length; j++) {
            if (retryResponse.translatedTexts[j] !== undefined) {
              missedItems[j].textNode.textContent = retryResponse.translatedTexts[j];
              translatedNodeTexts.set(missedItems[j].textNode, retryResponse.translatedTexts[j]);
              textTranslationCache.set(missedItems[j].originalText, retryResponse.translatedTexts[j]);
            }
          }
          pendingDomWrites--;
        }, 0);
        const stillMissed = retryResponse.missedIndices?.length ?? 0;
        console.log(`[PageTranslator] 补翻译完成，${missedItems.length - stillMissed}/${missedItems.length} 项成功`);
      } else {
        console.warn('[PageTranslator] 补翻译失败:', retryResponse.error);
        hasError = true;
      }
    } catch (e) {
      console.warn('[PageTranslator] 补翻译异常:', e);
      hasError = true;
    }
    // 等待补翻译的 DOM 写入完成
    while (pendingDomWrites > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  isPageTranslating = false;

  if (cancelled) {
    console.log('[PageTranslator] 翻译已被用户取消');
    isPageTranslated = true;
    markCancelled();
    return;
  }

  isPageTranslated = true;
  fixOverflowContainers();
  console.log('[PageTranslator] 整页翻译完成', hasError ? '（部分批次失败）' : '');
  finishProgress(hasError);
  startMutationObserver();
}

/** 恢复网页原文 */
export function restoreOriginalText(): void {
  console.log('[PageTranslator] 恢复原文，共', originalTexts.length, '个节点');
  stopMutationObserver();

  for (const item of originalTexts) {
    item.node.textContent = item.text;
  }

  // 还原被修改的容器 height 样式
  for (const fix of overflowFixes) {
    fix.el.style.height = fix.origHeight;
    fix.el.style.minHeight = fix.origMinHeight;
  }
  overflowFixes = [];

  originalTexts = [];
  translatedNodeTexts = new WeakMap();
  isPageTranslated = false;
  isPageTranslating = false;
  cancelled = false;

  removeProgressUI();
}

/** 停止 MutationObserver（供 messaging 模块在上下文失效时调用） */
export function stopMutationObserver(): void {
  if (mutationObserver) {
    console.log('[PageTranslator] 停止 MutationObserver');
    mutationObserver.disconnect();
    mutationObserver = null;
  }
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingNewNodes = [];
  translatedNodeTexts = new WeakMap();
  isAutoTranslating = false;
}

// ==========================================
// 文本节点收集
// ==========================================

const EXCLUDED_TAGS = new Set([
  'script', 'style', 'code', 'pre', 'textarea', 'input', 'select', 'option',
  'noscript', 'iframe', 'svg', 'math', 'canvas', 'video', 'audio', 'img'
]);

/**
 * 收集指定节点下所有符合条件的待翻译文本节点。
 * skipVisibilityCheck: MutationObserver 回调中新增节点可能尚未完成布局，跳过可见性检查。
 */
export function collectTextNodesFromElement(element: Node, skipVisibilityCheck = false): TranslateItem[] {
  const items: TranslateItem[] = [];

  function walk(node: Node): void {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();

      if (EXCLUDED_TAGS.has(tagName)) return;
      if (el.id?.startsWith('ai-translate-')) return;

      if (!skipVisibilityCheck) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;
      }

      if (el.isContentEditable) return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      const trimmed = text.trim();

      if (trimmed === '') return;
      if (/^\d+$/.test(trimmed)) return;
      if (/^https?:\/\//.test(trimmed)) return;
      if (trimmed.length <= 1) return;

      const chineseChars = text.match(/[\u4e00-\u9fff]/g);
      const chineseCount = chineseChars ? chineseChars.length : 0;
      if (chineseCount / text.length > 0.5) return;

      const parent = node.parentNode;
      const parentTag = parent ? (parent as HTMLElement).tagName || '' : '';

      items.push({ textNode: node, originalText: text, parentTag });
      return;
    }

    let child = node.firstChild;
    while (child) {
      walk(child);
      child = child.nextSibling;
    }
  }

  walk(element);
  return items;
}

/**
 * 估算文本的 token 数。
 * 启发式规则：ASCII 约 4 字符 = 1 token，CJK 约 1 字符 = 1.5 token，其他 1:1。
 */
function estimateTokens(text: string): number {
  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x7F) {
      // ASCII（英文、数字、标点）
      tokens += 0.25;
    } else if (
      (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK 统一汉字
      (code >= 0x3040 && code <= 0x30FF) ||   // 日文平假名 + 片假名
      (code >= 0xAC00 && code <= 0xD7AF)      // 韩文音节
    ) {
      tokens += 1.5;
    } else {
      tokens += 1;
    }
  }
  return Math.ceil(tokens);
}

/** 按 token 估算值分批，单批上限 MAX_BATCH_TOKENS */
function splitIntoBatches(items: TranslateItem[]): TranslateItem[][] {
  if (items.length === 0) return [];

  const batches: TranslateItem[][] = [];
  let currentBatch: TranslateItem[] = [];
  let currentTokens = 0;

  for (const item of items) {
    const itemTokens = estimateTokens(item.originalText);

    if (currentBatch.length > 0 && currentTokens + itemTokens > MAX_BATCH_TOKENS) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }

    currentBatch.push(item);
    currentTokens += itemTokens;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

// ==========================================
// 容器溢出修复
// ==========================================

/**
 * 翻译完成后扫描所有已翻译文本节点的祖先元素。
 * 若某个祖先有 overflow:hidden 且 height 是固定像素值（非 auto/''），
 * 则将 height 改为 min-height，防止中文译文行数更多时被裁剪。
 * 最多向上追溯 8 层，避免误改根容器。
 */
function fixOverflowContainers(): void {
  if (originalTexts.length === 0) return;

  const visited = new Set<HTMLElement>();

  for (const record of originalTexts) {
    let node: Node | null = record.node.parentNode;
    let depth = 0;
    while (node && depth < 8) {
      if (node.nodeType !== Node.ELEMENT_NODE) { node = node.parentNode; depth++; continue; }
      const el = node as HTMLElement;
      if (visited.has(el)) { node = node.parentNode; depth++; continue; }
      visited.add(el);

      const style = window.getComputedStyle(el);
      // 仅处理 overflow:hidden 且 height 被显式固定（不是 auto）的元素
      if (style.overflow === 'hidden' || style.overflowY === 'hidden') {
        const inlineHeight = el.style.height;
        const computedHeight = style.height;
        // 只修改有固定像素高度的元素（排除 auto、0px、空字符串）
        if (computedHeight && computedHeight !== 'auto' && computedHeight !== '0px') {
          overflowFixes.push({
            el,
            origHeight: inlineHeight,
            origMinHeight: el.style.minHeight
          });
          // 用 min-height 替代固定 height，内容超出时容器自动撑高
          el.style.height = 'auto';
          el.style.minHeight = computedHeight;
        }
      }
      node = node.parentNode;
      depth++;
    }
  }
  console.log('[PageTranslator] 修复溢出容器', overflowFixes.length, '个');
}

// ==========================================
// 辅助函数
// ==========================================

/** 保存/更新原始文本，防止复用节点时恢复错误的内容 */
function saveOriginalText(node: Node, text: string): void {
  const record = originalTexts.find(r => r.node === node);
  if (record) {
    record.text = text;
  } else {
    originalTexts.push({ node, text });
  }
}

/** 异步应用缓存译文，防止在 MutationObserver 回调中同步修改 DOM 干扰 React 协调器 */
function applyCachedTranslation(node: Node, originalText: string, cachedText: string): void {
  setTimeout(() => {
    saveOriginalText(node, originalText);
    node.textContent = cachedText;
    translatedNodeTexts.set(node, cachedText);
  }, 0);
}

/** 释放已移除节点的强引用，防止内存泄漏 */
function cleanOriginalTextsForRemovedNode(removedNode: Node): void {
  if (originalTexts.length === 0) return;

  const textNodes = new Set<Node>();
  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      textNodes.add(node);
      return;
    }
    let child = node.firstChild;
    while (child) {
      walk(child);
      child = child.nextSibling;
    }
  }
  walk(removedNode);

  if (textNodes.size > 0) {
    originalTexts = originalTexts.filter(record => !textNodes.has(record.node));
  }
}

// ==========================================
// MutationObserver 动态内容自动翻译
// ==========================================

function startMutationObserver(): void {
  if (mutationObserver) {
    stopMutationObserver();
  }
  console.log('[PageTranslator] 启动 MutationObserver 监听动态内容');

  mutationObserver = new MutationObserver((mutations: MutationRecord[]) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;

      // 处理节点移除，释放内存
      for (const removedNode of mutation.removedNodes) {
        cleanOriginalTextsForRemovedNode(removedNode);
      }

      // 处理新增节点
      for (const addedNode of mutation.addedNodes) {
        if (addedNode.nodeType !== Node.ELEMENT_NODE && addedNode.nodeType !== Node.TEXT_NODE) continue;
        if (addedNode instanceof HTMLElement && addedNode.id?.startsWith('ai-translate-')) continue;

        const newItems = collectTextNodesFromElement(addedNode, true);
        const filteredItems = newItems.filter(item => {
          // 缓存命中直接应用，不走 API
          const cached = textTranslationCache.get(item.originalText);
          if (cached) {
            applyCachedTranslation(item.textNode, item.originalText, cached);
            return false;
          }
          // 已翻译的节点跳过
          const lastTranslated = translatedNodeTexts.get(item.textNode);
          if (lastTranslated !== undefined && item.textNode.textContent === lastTranslated) {
            return false;
          }
          return true;
        });

        for (const item of filteredItems) {
          if (!pendingNewNodes.some(p => p.textNode === item.textNode)) {
            pendingNewNodes.push(item);
          }
        }
      }
    }

    // 有新内容且当前无翻译任务运行、无防抖定时器，则启动防抖
    if (pendingNewNodes.length > 0 && debounceTimer === null && !isAutoTranslating) {
      console.log('[PageTranslator] 检测到', pendingNewNodes.length, '个新增待翻译节点，等待防抖...');
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        void flushPendingTranslation();
      }, DEBOUNCE_DELAY);
    }
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
    // 不监听 characterData，避免自己替换文本时触发循环
  });
}

async function flushPendingTranslation(): Promise<void> {
  if (pendingNewNodes.length === 0 || isAutoTranslating) return;

  isAutoTranslating = true;

  try {
    const itemsToTranslate = [...pendingNewNodes];
    pendingNewNodes = [];

    console.log('[PageTranslator] 自动翻译新增内容:', itemsToTranslate.length, '个文本节点');

    // 显示自动翻译状态
    showAutoTranslateStatus(itemsToTranslate.length);

    const batches = splitIntoBatches(itemsToTranslate);
    const tasks = batches.map((batch, i) => async () => {
      if (!mutationObserver || isContextInvalidated()) return;

      try {
        const texts = batch.map(item => item.originalText);
        const response: TranslateBatchResponse = await safeSendMessageToBackground({
          action: 'translateBatch',
          texts,
          batchIndex: i,
          totalBatches: batches.length
        });

        if (!mutationObserver || isContextInvalidated()) return;

        if (response.success) {
          for (let j = 0; j < batch.length; j++) {
            if (typeof response.translatedTexts[j] === 'string') {
              saveOriginalText(batch[j].textNode, batch[j].originalText);
              batch[j].textNode.textContent = response.translatedTexts[j];
              translatedNodeTexts.set(batch[j].textNode, response.translatedTexts[j]);
              textTranslationCache.set(batch[j].originalText, response.translatedTexts[j]);
            }
          }
          console.log('[PageTranslator] 自动翻译批次完成，', batch.length, '段');
        } else {
          console.warn('[PageTranslator] 自动翻译失败:', response.error);
        }
      } catch (e) {
        console.warn('[PageTranslator] 动态翻译单批失败:', e);
      }
    });
    await runWithConcurrency(tasks, CONCURRENCY_LIMIT);
  } finally {
    isAutoTranslating = false;
    // 恢复进度条为完成状态
    finishProgress(false);
  }

  // 翻译期间可能又积累了新内容，通过防抖继续处理
  if (pendingNewNodes.length > 0 && debounceTimer === null) {
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      void flushPendingTranslation();
    }, DEBOUNCE_DELAY);
  }
}
