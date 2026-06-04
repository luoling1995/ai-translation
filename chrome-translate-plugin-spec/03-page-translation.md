# 整页翻译与动态内容翻译

> 版本：v1.3 | 日期：2026-06-03

> 返回总览：[chrome-translate-plugin-spec.md](../chrome-translate-plugin-spec.md)
>
> 适用任务：T04、T05、T07

---

### 2.3 整页翻译

#### 触发方式

1. 右键菜单 → "翻译整个页面"
2. 点击插件图标 → Popup 页面 → "翻译当前页面"按钮

#### 文本节点收集规则

Content Script 需要遍历 DOM 树，收集所有需要翻译的文本节点。规则如下：

**排除的标签**（这些标签内的所有文本不翻译）：
```
script, style, code, pre, textarea, input, select, option, 
noscript, iframe, svg, math, canvas, video, audio, img
```

**排除的文本**（匹配以下任一条件的文本节点跳过）：
1. 纯空白文本（`/^\s*$/` 匹配）
2. 纯数字文本（`/^\d+$/` 匹配）
3. 纯 URL 文本（`/^https?:\/\//` 开头）
4. 文本长度 ≤ 1 个字符
5. 中文字符占比 > 50%（中文字符正则：`/[\u4e00-\u9fff]/g`）

**排除的元素**（不可见元素）：
- `display: none` 的元素及其子节点
- `visibility: hidden` 的元素及其子节点
- `offsetParent === null` 且不是 `<body>` 或 `position: fixed` 的元素
- `element.isContentEditable === true` 的元素及其子节点

**收集结果的数据结构**：
```javascript
// 每个待翻译项
{
  textNode: Node,           // 原始 DOM 文本节点引用
  originalText: string,     // 原始文本内容
  parentTag: string         // 父元素标签名（用于调试）
}
```

#### 分批策略

将收集到的文本节点分批，每批满足以下条件：
- 每批的文本总字符数 ≤ 3000 字符
- 每批的文本段落数 ≤ 20 段
- 以上两个条件任一达到则切换到下一批

#### 翻译执行流程

```
1. 收集所有待翻译文本节点 → 得到 items[]
2. 按分批策略将 items 分为 batches[]
3. 在页面顶部插入进度条 UI（固定定位，z-index: 2147483647）
4. 依次（顺序，非并发）处理每个 batch：
   a. 将 batch 内所有文本作为 JSON 字符串数组发送到 Service Worker
   b. Service Worker 调用翻译 API，并要求模型只返回 JSON 字符串数组
   c. Service Worker 解析 JSON，得到 translatedTexts[]
   d. 如果解析成功且数组长度匹配，逐一将翻译结果写回对应的 textNode.textContent
   e. 如果解析失败或数组长度不匹配，该批次保持原文并标记为失败
   f. 更新进度条（已完成批次 / 总批次）
5. 全部完成 → 进度条文字改为"翻译完成"，显示"恢复原文"按钮
6. 启动 MutationObserver 监听新增 DOM 内容（见 §2.3.1）
```

#### 进度条 UI

- **位置**：页面顶部固定（`position: fixed; top: 0; left: 0; width: 100%; z-index: 2147483647`）
- **高度**：48px
- **背景**：半透明深色（`rgba(0, 0, 0, 0.85)`），白色文字
- **内容**：
  - 左侧：进度文字"正在翻译... (3/15)"
  - 中间：进度条（渐变色背景）
  - 右侧："取消"按钮
- **完成后**：进度文字变为"✓ 翻译完成"，"取消"按钮变为"恢复原文"按钮
- **通过 Shadow DOM 注入**

#### 恢复原文

- 在翻译前，将所有文本节点的原始文本保存在内存中（一个 Map 或数组）
- 点击"恢复原文"后，遍历保存的数据，将每个 `textNode.textContent` 恢复为原始值
- 恢复后移除进度条 UI
- **同时停止 MutationObserver**（`observer.disconnect()`），停止监听新增内容

#### 取消翻译

- 在翻译进行中点击"取消"按钮
- 设置一个 `cancelled` 标志位为 `true`
- 在每个 batch 发送前检查此标志，如果为 `true` 则停止后续 batch
- 不强制中断当前已经发出的 API 请求；取消会在当前批次返回后生效，避免为每个批次维护跨进程 AbortController
- 已翻译的部分保持译文不变（不自动恢复），进度条文字改为"翻译已取消"，显示"恢复原文"按钮
- **不启动 MutationObserver**（只有全部翻译完成时才启动）

#### 边界条件

| 场景 | 处理方式 |
|---|---|
| 页面没有需要翻译的文本（全是中文或全被过滤） | 显示进度条，立即显示"页面无需翻译"，3 秒后自动消失 |
| 翻译过程中用户导航到新页面 | Content Script 被销毁，自然停止，无需特殊处理 |
| 翻译返回的数组长度与请求段落数不一致 | 该批次所有文本保持原文，标记该批次失败，继续处理下一批次 |
| API 某一批次返回错误 | 该批次所有文本保持原文，继续处理下一批次。进度条不中断，但在完成后显示"翻译完成（部分段落翻译失败）" |
| 整页翻译进行中，用户触发划词翻译 | 允许，两者互不干扰。划词翻译使用独立的浮窗 |
| 已经完成整页翻译，再次触发整页翻译 | 先恢复原文（同时停止 MutationObserver），再重新执行整页翻译 |
| 页面非常长，收集到 1000+ 个文本节点 | 正常分批处理，无上限。但如果总批次 > 50，在进度条旁边显示预计耗时提示 |

### 2.3.1 动态内容自动翻译（MutationObserver）

用于处理 X.com、Reddit 等使用无限滚动加载的 SPA 页面。**仅在整页翻译完成后才激活。**

#### 触发条件

- 整页翻译全部完成（`isPageTranslated === true`）后自动启动
- 取消翻译时**不**启动
- 恢复原文时停止

#### 实现方案

```typescript
// 模块级变量
let mutationObserver: MutationObserver | null = null;
let pendingNewNodes: TranslateItem[] = [];  // 攒批用的缓冲区
let debounceTimer: number | null = null;
const DEBOUNCE_DELAY = 500; // 500ms 防抖
let translatedNodes = new WeakSet<Node>();   // 已翻译节点记录，防重复
let isAutoTranslating = false;               // 防止并发翻译

function startMutationObserver(): void {
  mutationObserver = new MutationObserver((mutations: MutationRecord[]) => {
    for (const mutation of mutations) {
      for (const addedNode of mutation.addedNodes) {
        // 跳过非元素节点和非文本节点
        if (addedNode.nodeType !== Node.ELEMENT_NODE && addedNode.nodeType !== Node.TEXT_NODE) {
          continue;
        }
        // 跳过插件自己注入的 UI 元素（通过 id 前缀 'ai-translate-' 识别）
        if (addedNode instanceof HTMLElement && addedNode.id?.startsWith('ai-translate-')) {
          continue;
        }
        // 收集新增节点中的待翻译文本
        const newItems = collectTextNodesFromElement(addedNode);
        // 过滤掉已翻译的节点
        const filteredItems = newItems.filter(item => !translatedNodes.has(item.textNode));
        pendingNewNodes.push(...filteredItems);
      }
    }

    // 有新内容时启动防抖定时器
    if (pendingNewNodes.length > 0) {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(() => {
        flushPendingTranslation();
      }, DEBOUNCE_DELAY);
    }
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

async function flushPendingTranslation(): Promise<void> {
  if (pendingNewNodes.length === 0 || isAutoTranslating) return;

  isAutoTranslating = true;
  try {
    // 取出当前缓冲区内容，清空缓冲区（让后续新增内容进入下一批）
    const itemsToTranslate = [...pendingNewNodes];
    pendingNewNodes = [];

    // 分批翻译（复用整页翻译的分批和翻译逻辑）
    const batches = splitIntoBatches(itemsToTranslate);
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      // 如果已经恢复原文（observer 被停止），中止翻译
      if (!mutationObserver) break;

      try {
        const texts = batch.map(item => item.originalText);
        const response = await chrome.runtime.sendMessage({
          action: 'translateBatch',
          texts,
          batchIndex: i,
          totalBatches: batches.length
        });
        if (response.success) {
          for (let j = 0; j < batch.length; j++) {
            if (typeof response.translatedTexts[j] === 'string') {
              // 保存原文用于恢复
              originalTexts.push({ node: batch[j].textNode, text: batch[j].originalText });
              batch[j].textNode.textContent = response.translatedTexts[j];
              translatedNodes.add(batch[j].textNode);
            }
          }
        }
      } catch {
        // 单批失败则跳过，不中断后续动态内容翻译
      }
      // 单批失败则跳过，不中断
    }
  } finally {
    isAutoTranslating = false;
  }

  // 翻译期间可能又积累了新内容，递归处理
  if (pendingNewNodes.length > 0) {
    void flushPendingTranslation();
  }
}

function stopMutationObserver(): void {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingNewNodes = [];
  translatedNodes = new WeakSet();
  isAutoTranslating = false;
}
```

#### 辅助函数说明

- `collectTextNodesFromElement(node)` 是对 §2.3 中文本节点收集逻辑的复用，接受一个 DOM 节点，递归收集其内部所有符合条件的文本节点。该函数被整页翻译的 `collectTextNodes()` 内部调用（`collectTextNodes()` 实际就是调用 `collectTextNodesFromElement(document.body)`），此处复用同一个函数。
- `splitIntoBatches(items)` 复用整页翻译的分批逻辑。
- `originalTexts` 是整页翻译时保存原文的数组，动态翻译的新内容也追加到这个数组中，确保「恢复原文」能恢复所有内容。

#### MutationObserver 配置说明

```typescript
mutationObserver.observe(document.body, {
  childList: true,   // 监听子节点增删
  subtree: true      // 监听所有后代节点
  // 不监听 characterData（文本内容变化），避免自己替换文本时触发无限循环
  // 不监听 attributes，不关心属性变化
});
```

> **为什么不监听 `characterData`**：当我们执行 `textNode.textContent = translatedText` 时，如果监听了 `characterData`，会触发 mutation 回调，可能导致循环翻译。只监听 `childList`（新增节点）可以避免此问题。

#### 边界条件

| 场景 | 处理方式 |
|---|---|
| 用户快速滚动，短时间内大量新节点加入 | 500ms 防抖，攒够一批再翻译 |
| 新增节点中包含插件自己的 UI 元素 | 通过 `id` 前缀 `ai-translate-` 过滤。所有插件注入的 Shadow DOM 宿主元素必须以此前缀命名 |
| 同一个文本节点被重复添加（如 DOM 移动操作） | 通过 `WeakSet<Node>` 记录已翻译节点，跳过重复 |
| 正在翻译动态内容时又来了新内容 | `isAutoTranslating` 标志防并发。新内容进入 `pendingNewNodes` 缓冲区，当前批次完成后继续处理 |
| SPA 路由跳转，整个页面内容替换 | 旧节点被移除，`textNode.textContent` 赋值静默失败。新页面内容作为新增节点被 Observer 捕获并翻译 |
| 恢复原文后，用户继续滚动 | Observer 已停止，新内容不会被翻译 |
| 新增内容是中文 | 由 `collectTextNodesFromElement` 中的中文占比过滤规则处理，不会发送到 API |
| 翻译动态内容失败 | 该批次保持原文，不影响后续批次，不显示错误提示（静默失败） |
| 页面 DOM 操作非常频繁（如每秒数十次） | `MutationObserver` 回调中只做收集操作（push 到数组），不做任何 DOM 操作或网络请求。实际翻译在防抖后的 `flushPendingTranslation` 中执行 |
