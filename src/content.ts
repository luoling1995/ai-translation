// 入口文件：划词翻译、事件监听、消息分发

import type { ExtensionToContentMessage, ContentToBackgroundMessage, TranslateResponse, PageStateResponse } from './types';
import { safeSendMessageToBackground, isContextInvalidated, onContextInvalidated } from './messaging';
import { removeProgressUI } from './progress-ui';
import { startPageTranslation, restoreOriginalText, getPageState, stopMutationObserver } from './page-translator';

// ==========================================
// Shadow DOM 宿主 ID
// ==========================================

const BUTTON_HOST_ID = 'ai-translate-button';
const POPUP_HOST_ID = 'ai-translate-popup';

// 右键菜单翻译请求 ID（校验响应归属）
let currentRequestId = '';

// 当前浮窗的 ShadowRoot 引用
let currentShadow: ShadowRoot | null = null;

// ==========================================
// CSS 基础样式
// ==========================================

const COMMON_STYLE = `
  :host {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #1F2937; line-height: 1.5; font-size: 14px; box-sizing: border-box;
  }
  * { box-sizing: border-box; }
`;

// ==========================================
// Shadow 容器工具
// ==========================================

function createShadowContainer(id: string): { host: HTMLDivElement; shadow: ShadowRoot } {
  const old = document.getElementById(id);
  if (old) old.remove();

  const host = document.createElement('div');
  host.id = id;
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; pointer-events: auto;';
  const shadow = host.attachShadow({ mode: 'closed' });
  document.body.appendChild(host);
  return { host, shadow };
}

function cleanupUI(): void {
  const oldButton = document.getElementById(BUTTON_HOST_ID);
  if (oldButton) oldButton.remove();
  const oldPopup = document.getElementById(POPUP_HOST_ID);
  if (oldPopup) oldPopup.remove();
  currentShadow = null;
}

// ==========================================
// 划词翻译按钮
// ==========================================

function showTranslateButton(rect: DOMRect, selectedText: string): void {
  cleanupUI();

  const { host, shadow } = createShadowContainer(BUTTON_HOST_ID);

  let left = rect.right + 8;
  let top = rect.bottom - 16;

  const buttonSize = 32;
  const padding = 8;
  const maxLeft = window.innerWidth - buttonSize - padding;
  const maxTop = window.innerHeight - buttonSize - padding;

  if (left > maxLeft) left = rect.left - 40;
  if (top > maxTop) top = rect.top - 40;

  left = Math.max(padding, Math.min(left, maxLeft));
  top = Math.max(padding, Math.min(top, maxTop));

  host.style.left = `${left}px`;
  host.style.top = `${top}px`;

  const style = document.createElement('style');
  style.textContent = `
    ${COMMON_STYLE}
    .translate-btn {
      width: 32px; height: 32px; border-radius: 50%;
      background-color: #4F46E5; color: #ffffff;
      border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      transition: background-color 0.2s, transform 0.1s;
      padding: 0;
    }
    .translate-btn:hover { background-color: #4338CA; transform: scale(1.05); }
    .translate-btn:active { transform: scale(0.95); }
    .translate-btn svg { width: 18px; height: 18px; fill: currentColor; }
  `;
  shadow.appendChild(style);

  const button = document.createElement('button');
  button.className = 'translate-btn';
  button.title = '翻译选中文本';
  button.innerHTML = `
    <svg viewBox="0 0 24 24">
      <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
    </svg>
  `;

  button.addEventListener('click', async (e) => {
    e.stopPropagation();
    cleanupUI();
    showTranslationPopup(rect, selectedText, 'loading');

    const msg: ContentToBackgroundMessage = {
      action: 'translate',
      text: selectedText
    };

    const response = await safeSendMessageToBackground(msg);
    updatePopupContent(selectedText, response);
  });

  shadow.appendChild(button);
}

// ==========================================
// 翻译浮窗
// ==========================================

function renderPopupDOM(
  originalText: string,
  state: 'loading' | 'success' | 'error',
  translatedText?: string,
  errorText?: string
): void {
  if (!currentShadow) return;

  currentShadow.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = `
    ${COMMON_STYLE}
    .popup-card {
      width: 350px; min-width: 300px; max-width: 500px; max-height: 400px;
      border-radius: 12px; background-color: #ffffff;
      box-shadow: 0 20px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
      border: 1px solid #E5E7EB;
      display: flex; flex-direction: column; overflow: hidden;
    }
    .header {
      padding: 10px 16px; background-color: #ffffff;
      border-bottom: 1px solid #E5E7EB;
      display: flex; justify-content: space-between; align-items: center;
    }
    .title { font-weight: 600; font-size: 13px; color: #6B7280; margin: 0; }
    .close-btn {
      background: none; border: none; cursor: pointer; color: #9CA3AF;
      font-size: 18px; padding: 0; line-height: 1;
      display: flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; border-radius: 4px;
      transition: background-color 0.2s, color 0.2s;
    }
    .close-btn:hover { background-color: #F3F4F6; color: #1F2937; }
    .content-body {
      flex: 1; overflow-y: auto; display: flex; flex-direction: column;
    }
    .translation-box {
      padding: 16px; font-size: 14px; background-color: #ffffff;
      min-height: 80px; display: flex; flex-direction: column; justify-content: center;
    }
    .translation-text {
      margin: 0; white-space: pre-wrap; word-break: break-word; color: #1F2937;
    }
    .loading-container {
      display: flex; align-items: center; color: #6B7280; gap: 12px; font-size: 13px;
    }
    .spinner {
      width: 18px; height: 18px; border: 2px solid #E5E7EB;
      border-top-color: #4F46E5; border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    .error-container {
      color: #EF4444; font-size: 13px; display: flex; align-items: center; gap: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  currentShadow.appendChild(style);

  const card = document.createElement('div');
  card.className = 'popup-card';

  const header = document.createElement('div');
  header.className = 'header';

  const title = document.createElement('h3');
  title.className = 'title';
  title.textContent = '翻译结果';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = '关闭';
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); cleanupUI(); });
  header.appendChild(closeBtn);
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'content-body';

  const translationBox = document.createElement('div');
  translationBox.className = 'translation-box';

  if (state === 'loading') {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading-container';
    loadingDiv.innerHTML = '<div class="spinner"></div><span>正在翻译...</span>';
    translationBox.appendChild(loadingDiv);
  } else if (state === 'error') {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-container';
    errorDiv.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
      </svg>
      <span>${errorText || '翻译失败，请重试'}</span>
    `;
    translationBox.appendChild(errorDiv);
  } else {
    const translationP = document.createElement('p');
    translationP.className = 'translation-text';
    translationP.textContent = translatedText || '';
    translationBox.appendChild(translationP);
  }

  body.appendChild(translationBox);
  card.appendChild(body);
  currentShadow.appendChild(card);
}

function showTranslationPopup(
  rect: DOMRect | null,
  originalText: string,
  state: 'loading' | 'success' | 'error',
  translatedText?: string,
  errorText?: string,
  isCenter: boolean = false
): void {
  let container = document.getElementById(POPUP_HOST_ID);
  let shadowRoot: ShadowRoot;

  if (!container) {
    const { host, shadow } = createShadowContainer(POPUP_HOST_ID);
    container = host;
    shadowRoot = shadow;

    let left = 0;
    let top = 0;
    const popupWidth = 350;

    if (isCenter || !rect) {
      left = window.innerWidth / 2 - popupWidth / 2;
      top = window.innerHeight / 3;
    } else {
      left = rect.left;
      top = rect.bottom + 8;

      const padding = 8;
      const maxLeft = window.innerWidth - popupWidth - padding;
      const maxTop = window.innerHeight - 200 - padding;

      if (left > maxLeft) left = window.innerWidth - popupWidth - padding;
      if (top > maxTop) top = rect.top - 200 - padding;

      left = Math.max(padding, left);
      top = Math.max(padding, top);
    }

    container.style.left = `${left}px`;
    container.style.top = `${top}px`;
  } else {
    shadowRoot = currentShadow!;
  }

  currentShadow = shadowRoot;
  renderPopupDOM(originalText, state, translatedText, errorText);
}

function updatePopupContent(originalText: string, response: TranslateResponse): void {
  if (response.success) {
    renderPopupDOM(originalText, 'success', response.translatedText);
  } else {
    renderPopupDOM(originalText, 'error', undefined, response.error);
  }
}

// ==========================================
// 事件监听
// ==========================================

function handleMouseUp(e: MouseEvent): void {
  if (isContextInvalidated()) return;

  setTimeout(() => {
    const target = e.target as HTMLElement;
    if (target && (
      target.id === BUTTON_HOST_ID || target.id === POPUP_HOST_ID ||
      target.closest(`#${BUTTON_HOST_ID}`) || target.closest(`#${POPUP_HOST_ID}`)
    )) {
      return;
    }

    let selectedText = '';
    let rect: DOMRect | null = null;

    if (target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const input = target;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      if (start !== null && end !== null && start !== end) {
        selectedText = input.value.substring(start, end);
        rect = input.getBoundingClientRect();
      }
    } else {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        selectedText = selection.toString();
        if (selectedText.trim()) {
          const rects = range.getClientRects();
          rect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
        }
      }
    }

    const trimmed = selectedText.trim();
    if (!trimmed || trimmed.length > 5000) {
      cleanupUI();
      return;
    }

    if (rect) {
      showTranslateButton(rect, selectedText);
    }
  }, 10);
}

function handleMouseDown(e: MouseEvent): void {
  if (isContextInvalidated()) return;
  const target = e.target as HTMLElement;
  if (target) {
    if (target.id === BUTTON_HOST_ID || target.closest(`#${BUTTON_HOST_ID}`)) return;
    if (target.id === POPUP_HOST_ID || target.closest(`#${POPUP_HOST_ID}`)) return;
  }
  cleanupUI();
}

function handleKeyDown(e: KeyboardEvent): void {
  if (isContextInvalidated()) return;
  if (e.key === 'Escape') cleanupUI();
}

// ==========================================
// 初始化
// ==========================================

// 注册上下文失效时的清理回调
onContextInvalidated(() => {
  cleanupUI();
  removeProgressUI();
  stopMutationObserver();
  document.removeEventListener('mouseup', handleMouseUp);
  document.removeEventListener('mousedown', handleMouseDown);
  document.removeEventListener('keydown', handleKeyDown);
});

// 绑定 DOM 事件
document.addEventListener('mouseup', handleMouseUp);
document.addEventListener('mousedown', handleMouseDown);
document.addEventListener('keydown', handleKeyDown);

// 监听来自 Popup / Background 的消息
chrome.runtime.onMessage.addListener((
  message: ExtensionToContentMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: any) => void
) => {
  console.log('[Content] 收到消息:', message.action);

  if (message.action === 'getPageState') {
    const state = getPageState();
    const response: PageStateResponse = {
      success: true,
      isPageTranslating: state.isPageTranslating,
      isPageTranslated: state.isPageTranslated
    };
    sendResponse(response);
    return false;
  }

  if (message.action === 'translatePage') {
    console.log('[Content] 触发整页翻译');
    startPageTranslation();
    return;
  }

  if (message.action === 'restorePage') {
    console.log('[Content] 触发恢复原文');
    restoreOriginalText();
    return;
  }

  if (message.action === 'showTranslation') {
    const { requestId, state, originalText, translatedText, error } = message;
    if (state === 'loading') {
      currentRequestId = requestId;
      cleanupUI();
      showTranslationPopup(null, originalText, 'loading', undefined, undefined, true);
    } else {
      if (currentRequestId === requestId) {
        showTranslationPopup(null, originalText, state, translatedText, error, true);
      }
    }
    return;
  }
});
