// 进度条 UI 模块（Shadow DOM 隔离）

const PROGRESS_HOST_ID = 'ai-translate-progress';

// 统一的 CSS 基础样式
const BASE_STYLE = `
  :host {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #ffffff; line-height: 1.5; font-size: 14px; box-sizing: border-box;
  }
  * { box-sizing: border-box; }
`;

export interface ProgressCallbacks {
  onCancel: () => void;
  onRestore: () => void;
}

let progressShadow: ShadowRoot | null = null;
let progressCallbacks: ProgressCallbacks | null = null;

/** 创建并显示进度条 */
export function showProgressUI(callbacks: ProgressCallbacks): void {
  removeProgressUI();
  progressCallbacks = callbacks;

  const host = document.createElement('div');
  host.id = PROGRESS_HOST_ID;
  host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 100%; height: 48px; z-index: 2147483647; pointer-events: auto;';

  const shadow = host.attachShadow({ mode: 'closed' });
  progressShadow = shadow;

  const style = document.createElement('style');
  style.textContent = `
    ${BASE_STYLE}
    .progress-bar-container {
      width: 100%; height: 48px;
      background-color: rgba(0, 0, 0, 0.85);
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 24px; color: #ffffff; font-size: 13px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    }
    .left-section {
      display: flex; align-items: center; gap: 10px;
      white-space: nowrap; font-weight: 500;
    }
    .spinner {
      width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #818CF8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      display: none;
    }
    .spinner.active { display: block; }
    .progress-track {
      flex: 1; height: 6px;
      background-color: rgba(255, 255, 255, 0.2);
      border-radius: 3px; margin: 0 24px; overflow: hidden;
    }
    .progress-fill {
      width: 0%; height: 100%;
      background: linear-gradient(90deg, #4F46E5, #818CF8);
      border-radius: 3px; transition: width 0.3s ease;
    }
    .control-btn {
      background-color: transparent;
      border: 1px solid rgba(255, 255, 255, 0.4);
      color: #ffffff; padding: 5px 14px; border-radius: 6px;
      cursor: pointer; font-size: 12px;
      transition: all 0.2s; white-space: nowrap;
    }
    .control-btn:hover {
      background-color: rgba(255, 255, 255, 0.1);
      border-color: #ffffff;
    }
    .control-btn:active { transform: scale(0.97); }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  shadow.appendChild(style);

  const container = document.createElement('div');
  container.className = 'progress-bar-container';
  container.innerHTML = `
    <div class="left-section">
      <div class="spinner active" id="prog-spinner"></div>
      <span id="prog-text">正在准备翻译...</span>
    </div>
    <div class="progress-track">
      <div class="progress-fill" id="prog-fill"></div>
    </div>
    <button class="control-btn" id="prog-btn">取消</button>
  `;
  shadow.appendChild(container);

  const button = shadow.getElementById('prog-btn') as HTMLButtonElement;
  button.addEventListener('click', () => {
    if (!progressCallbacks) return;
    if (button.dataset.action === 'restore') {
      progressCallbacks.onRestore();
    } else {
      progressCallbacks.onCancel();
    }
  });

  document.body.appendChild(host);
}

/** 更新翻译进度（整页翻译时调用） */
export function updateProgress(current: number, total: number, text?: string): void {
  if (!progressShadow) return;
  const textEl = progressShadow.getElementById('prog-text');
  const fillEl = progressShadow.getElementById('prog-fill');
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  if (textEl) {
    textEl.textContent = text || `正在翻译... (${current}/${total})`;
  }
  if (fillEl) {
    fillEl.style.width = `${percent}%`;
  }
}

/** 显示"正在翻译新内容"状态（MutationObserver 触发时调用） */
export function showAutoTranslateStatus(pendingCount: number): void {
  if (!progressShadow) return;
  const textEl = progressShadow.getElementById('prog-text');
  const spinnerEl = progressShadow.getElementById('prog-spinner');
  if (textEl) textEl.textContent = `正在翻译新内容... (${pendingCount}段)`;
  if (spinnerEl) spinnerEl.classList.add('active');
}

/** 标记翻译完成 */
export function finishProgress(hasError: boolean): void {
  if (!progressShadow) return;
  const textEl = progressShadow.getElementById('prog-text');
  const fillEl = progressShadow.getElementById('prog-fill');
  const btnEl = progressShadow.getElementById('prog-btn') as HTMLButtonElement | null;
  const spinnerEl = progressShadow.getElementById('prog-spinner');

  if (textEl) {
    textEl.textContent = hasError ? '✓ 翻译完成（部分段落翻译失败）' : '✓ 翻译完成';
  }
  if (fillEl) fillEl.style.width = '100%';
  if (spinnerEl) spinnerEl.classList.remove('active');
  if (btnEl) {
    btnEl.textContent = '恢复原文';
    btnEl.dataset.action = 'restore';
  }
}

/** 标记翻译已取消 */
export function markCancelled(): void {
  if (!progressShadow) return;
  const textEl = progressShadow.getElementById('prog-text');
  const btnEl = progressShadow.getElementById('prog-btn') as HTMLButtonElement | null;
  const spinnerEl = progressShadow.getElementById('prog-spinner');

  if (textEl) textEl.textContent = '翻译已取消';
  if (spinnerEl) spinnerEl.classList.remove('active');
  if (btnEl) {
    btnEl.textContent = '恢复原文';
    btnEl.dataset.action = 'restore';
  }
}

/** 显示"页面无需翻译"并自动消失 */
export function showNoContentMessage(): void {
  showProgressUI({ onCancel: () => {}, onRestore: () => {} });
  const textEl = progressShadow?.getElementById('prog-text');
  const btnEl = progressShadow?.getElementById('prog-btn') as HTMLButtonElement | null;
  const spinnerEl = progressShadow?.getElementById('prog-spinner');

  if (textEl) textEl.textContent = '页面无需翻译';
  if (spinnerEl) spinnerEl.classList.remove('active');
  if (btnEl) btnEl.style.display = 'none';

  setTimeout(() => removeProgressUI(), 3000);
}

/** 移除进度条 */
export function removeProgressUI(): void {
  const host = document.getElementById(PROGRESS_HOST_ID);
  if (host) host.remove();
  progressShadow = null;
  progressCallbacks = null;
}
