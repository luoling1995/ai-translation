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
