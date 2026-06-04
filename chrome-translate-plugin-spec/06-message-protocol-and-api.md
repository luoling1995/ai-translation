# 消息协议与 MiniMax API 适配

> 版本：v1.3 | 日期：2026-06-03

> 返回总览：[chrome-translate-plugin-spec.md](../chrome-translate-plugin-spec.md)
>
> 适用任务：T01、T02、T04、T05、T06、T07

---

### 3.4 消息通信协议

Content Script 与 Service Worker 之间通过 `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` 通信。所有消息遵循统一格式。

#### 类型定义（types.ts）

```typescript
// ===== 存储结构 =====
export interface StorageData {
  apiKey: string;
  modelName: string;  // 默认 'MiniMax-M2.7'
}

// ===== Content Script → Service Worker 的消息 =====
export interface TranslateMessage {
  action: 'translate';
  text: string;
}

export interface TranslateBatchMessage {
  action: 'translateBatch';
  texts: string[];
  batchIndex?: number;     // 当前批次序号（从0开始，用于日志）
  totalBatches?: number;   // 总批次数（用于日志）
}

export type ContentToBackgroundMessage = TranslateMessage | TranslateBatchMessage;

// ===== Popup / Service Worker → Content Script 的消息 =====
export interface ShowTranslationMessage {
  action: 'showTranslation';
  requestId: string;
  state: 'loading' | 'success' | 'error';
  originalText: string;
  translatedText?: string;
  error?: string;
}

export interface TranslatePageMessage {
  action: 'translatePage';
}

export interface RestorePageMessage {
  action: 'restorePage';
}

export interface GetPageStateMessage {
  action: 'getPageState';
}

export type ExtensionToContentMessage =
  | ShowTranslationMessage
  | TranslatePageMessage
  | RestorePageMessage
  | GetPageStateMessage;

// ===== sendMessage 的响应格式 =====
export interface TranslateSuccessResponse {
  success: true;
  translatedText: string;  // 单条翻译
}

export interface TranslateBatchSuccessResponse {
  success: true;
  translatedTexts: string[];  // 批量翻译
}

export interface TranslateErrorResponse {
  success: false;
  error: string;
}

export type TranslateResponse = TranslateSuccessResponse | TranslateErrorResponse;
export type TranslateBatchResponse = TranslateBatchSuccessResponse | TranslateErrorResponse;

export interface PageStateResponse {
  success: true;
  isPageTranslating: boolean;
  isPageTranslated: boolean;
}

// ===== 内部数据结构 =====
export interface TranslateItem {
  textNode: Node;           // 原始 DOM 文本节点引用
  originalText: string;     // 原始文本内容
  parentTag: string;        // 父元素标签名（用于调试）
}

export interface OriginalTextRecord {
  node: Node;               // 文本节点引用
  text: string;             // 原始文本
}
```

#### 异步响应要求

- `chrome.runtime.onMessage` 中只要存在异步逻辑，并且使用 `sendResponse` 异步返回结果，监听函数必须 `return true`，防止响应通道提前关闭。
- Popup 向当前 tab 发送 `getPageState`，Content Script 返回 `PageStateResponse`，Popup 据此决定"恢复原文"按钮是否可点击。
- 向 Content Script 发送消息时必须检查 `chrome.runtime.lastError` 或捕获 Promise rejection。Chrome 受限页面（如 `chrome://`、Chrome Web Store、扩展页面）可能无法注入 Content Script，此时 Popup 或右键菜单显示"当前页面不支持翻译"。

### 3.5 核心流程

#### 3.5.1 划词翻译流程

```
1. Content Script 监听 document 的 mouseup 事件
2. 在事件处理函数中：
   a. 调用 cleanupUI() 移除已有的翻译按钮和浮窗
   b. 延迟 10ms（setTimeout）后执行以下逻辑（等待 selection 更新）：
      - 如果事件目标是 input/textarea，使用 `selectionStart` / `selectionEnd` 获取选中文本，并用目标元素的 `getBoundingClientRect()` 估算按钮位置
      - 否则获取 `selection = window.getSelection()`
      - 获取 `rawText = selection.toString()`，并用 `trimmedText = rawText.trim()` 做长度和空白判断
      - 如果 trimmedText 长度为 0 或 rawText 长度 > 5000，return
      - 获取 range = selection.getRangeAt(0)
      - 获取 `range.getClientRects()` 的最后一个非空 rect；没有可用 rect 时使用 `range.getBoundingClientRect()`
      - 在 rect 位置附近创建翻译按钮
3. 翻译按钮被点击：
   a. 移除翻译按钮
   b. 创建翻译浮窗（显示加载状态）
   c. 发送 { action: "translate", text: rawText } 到 Service Worker
   d. 等待响应
   e. 成功 → 更新浮窗显示译文
   f. 失败 → 更新浮窗显示错误消息
```

#### 3.5.2 右键菜单流程

```
1. background.ts 在 chrome.runtime.onInstalled 回调中：
   chrome.contextMenus.create({ id: 'translate-selection', title: '翻译选中文本', contexts: ['selection'] })
   chrome.contextMenus.create({ id: 'translate-page', title: '翻译整个页面', contexts: ['page'] })

2. background.ts 监听 chrome.contextMenus.onClicked：
   - 如果 menuItemId === 'translate-selection'：
      a. 从 info.selectionText 获取文本
      b. 检查长度 ≤ 5000
      c. 生成 requestId，先发送 { action: "showTranslation", requestId, state: "loading", originalText } 给当前 tab
      d. 调用翻译 API
      e. 再发送 { action: "showTranslation", requestId, state: "success", originalText, translatedText } 或 { action: "showTranslation", requestId, state: "error", originalText, error } 给当前 tab
    - 如果 menuItemId === 'translate-page'：
      a. 通过 chrome.tabs.sendMessage 发送 { action: "translatePage" } 给当前 tab

3. content.ts 监听 chrome.runtime.onMessage：
   - 收到 action === "showTranslation" 且 state === "loading"：在页面中心创建翻译浮窗显示加载状态，并记录 requestId
   - 收到 action === "showTranslation" 且 state 是 "success" 或 "error"：仅当 requestId 与当前浮窗一致时更新结果
   - 收到 action === "translatePage"：调用 startPageTranslation()
   - 收到 action === "restorePage"：调用 restoreOriginalText()
   - 收到 action === "getPageState"：返回 { success: true, isPageTranslating, isPageTranslated }
```

#### 3.5.3 整页翻译流程

```
1. startPageTranslation() 被调用
2. 如果 isPageTranslating === true，直接 return（防止重复触发）
3. 如果已有翻译结果（isPageTranslated === true），先调用 restoreOriginalText()（会停止 MutationObserver）
4. 设置 isPageTranslating = true
5. 调用 collectTextNodes() 收集所有待翻译文本节点 → items[]
6. 如果 items.length === 0：显示"页面无需翻译"提示，设置 `isPageTranslating = false`、`isPageTranslated = false`，3 秒后移除提示，然后 return
7. 保存原始文本：originalTexts = items.map(item => ({ node: item.textNode, text: item.originalText }))
8. 将所有待翻译节点加入 translatedNodes WeakSet（标记为已处理，防止 MutationObserver 重复翻译）
9. 调用 splitIntoBatches(items) 分批 → batches[]
10. 显示进度条 UI
11. 设置 cancelled = false
12. for (let i = 0; i < batches.length; i++):
    a. 如果 cancelled === true，break
    b. 更新进度条文字："正在翻译... ({i+1}/{batches.length})"
    c. 更新进度条宽度：((i+1) / batches.length * 100) + '%'
    d. 提取 batch 中所有文本 → texts[]
    e. 发送 { action: "translateBatch", texts, batchIndex: i, totalBatches: batches.length } 到 Service Worker
    f. 等待响应 response
    g. 如果 response.success === true：
       - 获取 translatedTexts = response.translatedTexts
       - for (let j = 0; j < batch.length; j++):
           如果 translatedTexts[j] 存在，batch[j].textNode.textContent = translatedTexts[j]
    h. 如果 response.success === false：
       - 标记 hasError = true（该批次保持原文）
13. 循环结束后设置 `isPageTranslating = false`
14. 如果 cancelled === true：保持已翻译内容，设置 `isPageTranslated = true`，进度条显示"翻译已取消"和"恢复原文"按钮，不启动 MutationObserver
15. 如果 cancelled === false：设置 `isPageTranslated = true`，根据 hasError 显示"翻译完成"或"翻译完成（部分段落翻译失败）"，显示"恢复原文"按钮
16. 如果 cancelled === false，调用 startMutationObserver() 启动动态内容监听
```

### 3.6 MiniMax API 调用方案

> MiniMax 的 endpoint、鉴权 Header、模型名称和响应结构必须以实施时的官方文档为准。本节代码按 OpenAI 兼容 `chat/completions` 形态描述；如果 MiniMax 当前接口不同，应只调整 Service Worker 中的 API 适配层，不影响 Content Script、Popup 和消息协议。

#### Service Worker 中的翻译函数

```typescript
// background.ts 中的核心翻译函数
import type { TranslateResponse, StorageData } from './types';

const MINIMAX_CHAT_COMPLETIONS_URL = 'https://api.minimax.io/v1/chat/completions';

async function callTranslateAPI(text: string, isMultiSegment: boolean = false): Promise<TranslateResponse> {
  // 1. 从 storage 读取配置
  const { apiKey, modelName } = await chrome.storage.local.get(['apiKey', 'modelName']) as StorageData;

  if (!apiKey) {
    return { success: false, error: '请先在插件设置中配置 API Key' };
  }

  const model = modelName || 'MiniMax-M2.7';

  // 2. 构建 prompt
  let systemPrompt;
  if (isMultiSegment) {
    systemPrompt = '你是一个专业的翻译助手。用户会提供一个 JSON 字符串数组。请将数组中的每一项翻译为简体中文，并只返回 JSON 字符串数组。要求：1. 自动识别源语言；2. 如果某项已经是中文，保持原文不变；3. 输出数组长度、顺序必须与输入完全一致；4. 不要添加 Markdown、解释、序号或额外字段；5. 保留每项文本内部的换行和前后空白。';
  } else {
    systemPrompt = '你是一个专业的翻译助手。请将用户提供的文本翻译为简体中文。要求：1. 自动识别源语言；2. 如果原文已经是中文，直接返回原文；3. 只返回翻译结果，不要添加任何解释或额外内容；4. 保持原文的格式和换行。';
  }

  // 3. 发送请求（带 30 秒超时）
  const controller: AbortController = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    // MiniMax endpoint、鉴权 Header、模型名以当前官方文档为准；此处按 OpenAI 兼容 chat completions 形态描述。
    const response = await fetch(MINIMAX_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.3
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // 4. 处理 HTTP 错误
    if (!response.ok) {
      if (response.status === 401) return { success: false, error: 'API Key 无效，请检查设置' };
      if (response.status === 429) return { success: false, error: '请求过于频繁，请稍后再试' };
      if ([500, 502, 503].includes(response.status)) return { success: false, error: '翻译服务暂时不可用，请稍后再试' };
      return { success: false, error: `翻译失败（错误码：${response.status}）` };
    }

    // 5. 解析响应
    let data;
    try {
      data = await response.json();
    } catch {
      return { success: false, error: '翻译服务返回了无效的响应' };
    }
    if (!data.choices || data.choices.length === 0) {
      return { success: false, error: '翻译服务返回了空结果，请重试' };
    }

    return { success: true, translatedText: data.choices[0].message.content };

  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') return { success: false, error: '翻译请求超时，请稍后再试' };
    return { success: false, error: '网络连接失败，请检查网络' };
  }
}
```

#### 批量翻译的请求/响应处理

```typescript
import type { TranslateBatchResponse } from './types';

// 批量翻译：将多段文本合并为一次 API 调用
async function translateBatch(texts: string[]): Promise<TranslateBatchResponse> {
  const combinedText = JSON.stringify(texts);
  const result = await callTranslateAPI(combinedText, true);

  if (!result.success) {
    return result;
  }

  let translatedTexts: unknown;
  try {
    translatedTexts = JSON.parse(result.translatedText);
  } catch {
    return { success: false, error: '翻译服务返回了无效的响应' };
  }

  if (!Array.isArray(translatedTexts) || translatedTexts.length !== texts.length || !translatedTexts.every(item => typeof item === 'string')) {
    return { success: false, error: '翻译服务返回了无效的响应' };
  }

  return { success: true, translatedTexts };
}
```
