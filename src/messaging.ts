// 通信与上下文失效处理模块

// 上下文失效回调列表
const invalidatedCallbacks: (() => void)[] = [];

/**
 * 注册上下文失效时的清理回调。
 * 各模块在初始化时调用此函数注册自己的清理逻辑，避免循环依赖。
 */
export function onContextInvalidated(callback: () => void): void {
  invalidatedCallbacks.push(callback);
}

/** 检测扩展上下文是否失效（插件已重载或更新） */
export function isContextInvalidated(): boolean {
  try {
    return !chrome.runtime || !chrome.runtime.id;
  } catch {
    return true;
  }
}

/** 执行所有上下文失效清理回调，并显示刷新提示 */
function handleContextInvalidated(): void {
  for (const cb of invalidatedCallbacks) {
    try { cb(); } catch (e) { console.warn('[Messaging] 清理回调执行失败:', e); }
  }
  console.warn('[Content] 插件上下文已失效（插件可能已重新加载或更新），已自动清理 UI 并卸载事件监听。请刷新页面后继续使用。');
  showRefreshToast();
}

/**
 * 安全地发送消息给 background。
 * 通过 callback 捕获 lastError，避免 Chrome 报"通道关闭"未捕获异常。
 */
export function safeSendMessageToBackground(message: any): Promise<any> {
  return new Promise((resolve) => {
    if (isContextInvalidated()) {
      handleContextInvalidated();
      resolve({ success: false, error: '插件已更新，请刷新页面重试' });
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.warn('[Messaging] 发送后台消息失败:', err.message);
          if (err.message && err.message.includes('Extension context invalidated')) {
            handleContextInvalidated();
          }
          resolve({ success: false, error: err.message });
          return;
        }
        resolve(response);
      });
    } catch (e: any) {
      console.warn('[Messaging] 发送后台消息同步异常:', e.message);
      if (e.message && e.message.includes('Extension context invalidated')) {
        handleContextInvalidated();
      }
      resolve({ success: false, error: e.message || '发送消息失败' });
    }
  });
}

/** 显示刷新提示 Toast 气泡 */
export function showRefreshToast(): void {
  const TOAST_ID = 'ai-translate-refresh-toast';
  if (document.getElementById(TOAST_ID)) return;

  const host = document.createElement('div');
  host.id = TOAST_ID;
  host.style.cssText = 'position: fixed; bottom: 24px; right: 24px; z-index: 2147483647; pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    .toast-card {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 18px;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(229, 231, 235, 0.5); border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1);
      color: #1F2937; font-size: 13px; font-weight: 500;
      opacity: 0; transform: translateY(10px);
      animation: fadeInUp 0.4s cubic-bezier(0.16,1,0.3,1) forwards, fadeOut 0.4s cubic-bezier(0.16,1,0.3,1) 4.6s forwards;
    }
    .icon {
      display: flex; align-items: center; justify-content: center;
      width: 20px; height: 20px;
      background: linear-gradient(135deg, #4F46E5, #818CF8);
      color: #fff; border-radius: 50%;
    }
    .icon svg { width: 12px; height: 12px; animation: spin 3s linear infinite; }
    .btn-refresh {
      background: linear-gradient(135deg, #4F46E5, #4338CA);
      border: none; color: white; padding: 4px 8px; border-radius: 6px;
      margin-left: 8px; cursor: pointer; font-size: 11px; font-weight: 600;
      pointer-events: auto; transition: all 0.2s;
    }
    .btn-refresh:hover { box-shadow: 0 0 8px rgba(79,70,229,0.4); transform: scale(1.03); }
    .btn-refresh:active { transform: scale(0.97); }
    @keyframes fadeInUp { to { opacity: 1; transform: translateY(0); } }
    @keyframes fadeOut { to { opacity: 0; transform: translateY(-10px); } }
    @keyframes spin { 100% { transform: rotate(360deg); } }
  `;

  const card = document.createElement('div');
  card.className = 'toast-card';
  card.innerHTML = `
    <div class="icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
      </svg>
    </div>
    <span>AI 翻译助手已更新，请刷新网页后继续使用</span>
    <button class="btn-refresh" id="refresh-btn">立即刷新</button>
  `;

  const refreshBtn = card.querySelector('#refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => window.location.reload());
  }

  shadow.appendChild(style);
  shadow.appendChild(card);
  document.body.appendChild(host);

  setTimeout(() => host.remove(), 5000);
}
