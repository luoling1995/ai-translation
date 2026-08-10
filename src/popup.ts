import type { PageStateResponse, ExtensionToContentMessage, StorageData } from './types';

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
  const modelNameInput = document.getElementById('model-name') as HTMLInputElement;
  const apiKeyError = document.getElementById('api-key-error') as HTMLDivElement;
  
  const testBtn = document.getElementById('test-connection') as HTMLButtonElement;
  const saveBtn = document.getElementById('save-config') as HTMLButtonElement;
  const translateBtn = document.getElementById('translate-page') as HTMLButtonElement;
  const restoreBtn = document.getElementById('restore-page') as HTMLButtonElement;
  
  const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
  const statusText = document.getElementById('status-text') as HTMLSpanElement;

  let activeTabId: number | null = null;

  // 1. 初始化读取配置
  chrome.storage.local.get(['apiKey', 'modelName'], (result) => {
    const data = result as any as StorageData;
    if (data.apiKey) {
      apiKeyInput.value = data.apiKey;
    }
    if (data.modelName) {
      modelNameInput.value = data.modelName;
    }
  });

  // 2. 检查当前页面状态
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || typeof tab.id !== 'number') {
      showUnsupportedPage('当前页面不支持翻译');
      return;
    }

    activeTabId = tab.id;

    // 向页面发送查询状态
    chrome.tabs.sendMessage(activeTabId, { action: 'getPageState' }, (response: PageStateResponse) => {
      // 捕捉 lastError，如果在受限页面（比如 chrome://）则无法通信
      const err = chrome.runtime.lastError;
      if (err) {
        showUnsupportedPage('当前页面不支持翻译');
        return;
      }

      if (response && response.success) {
        const { isPageTranslating, isPageTranslated } = response;
        updateUIState(isPageTranslating, isPageTranslated);
      } else {
        showUnsupportedPage('获取页面状态失败');
      }
    });
  });

  // 更新 UI 状态
  function updateUIState(isPageTranslating: boolean, isPageTranslated: boolean) {
    translateBtn.removeAttribute('disabled');
    
    if (isPageTranslating) {
      statusDot.className = 'status-dot warning';
      statusText.textContent = '正在翻译页面中...';
      translateBtn.setAttribute('disabled', 'true');
      restoreBtn.setAttribute('disabled', 'true');
    } else if (isPageTranslated) {
      statusDot.className = 'status-dot active';
      statusText.textContent = '页面已翻译为中文';
      restoreBtn.removeAttribute('disabled');
    } else {
      statusDot.className = 'status-dot active';
      statusText.textContent = '页面支持翻译';
      restoreBtn.setAttribute('disabled', 'true');
    }
  }

  // 展现不支持翻译页面
  function showUnsupportedPage(reason: string) {
    statusDot.className = 'status-dot error';
    statusText.textContent = reason;
    translateBtn.setAttribute('disabled', 'true');
    restoreBtn.setAttribute('disabled', 'true');
  }

  // 3. 测试连接性
  let testTimeoutId: number | null = null;
  testBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      apiKeyInput.classList.add('error');
      apiKeyError.textContent = '请先输入 API Key';
      setTimeout(() => {
        apiKeyInput.classList.remove('error');
        apiKeyError.textContent = '';
      }, 2000);
      return;
    }

    // 设置状态为测试中
    testBtn.setAttribute('disabled', 'true');
    testBtn.textContent = '测试中...';
    testBtn.classList.remove('btn-success', 'btn-error');
    apiKeyError.textContent = '';

    let isSettled = false;

    // 10 秒超时控制
    testTimeoutId = window.setTimeout(() => {
      if (isSettled) return;
      isSettled = true;
      testBtn.removeAttribute('disabled');
      testBtn.textContent = '连接超时';
      testBtn.classList.add('btn-error');
      apiKeyError.textContent = '测试超时，请检查网络设置';
      
      setTimeout(() => {
        testBtn.textContent = '测试连接';
        testBtn.classList.remove('btn-success', 'btn-error');
      }, 3000);
    }, 10000);

    // 向 SW 发起单条短句翻译测试
    chrome.runtime.sendMessage({
      action: 'translate',
      text: '请回复 ok',
      apiKey,
      modelName: modelNameInput.value.trim() || 'MiniMax-M2.7'
    }, (response) => {
      if (isSettled) return;
      isSettled = true;
      if (testTimeoutId !== null) {
        clearTimeout(testTimeoutId);
        testTimeoutId = null;
      }

      testBtn.removeAttribute('disabled');
      const err = chrome.runtime.lastError;

      if (err) {
        testBtn.textContent = '连接失败';
        testBtn.classList.add('btn-error');
        apiKeyError.textContent = '连接插件后台失败，请刷新重试';
        return;
      }

      if (response && response.success) {
        testBtn.textContent = '✓ 连接成功';
        testBtn.classList.add('btn-success');
        setTimeout(() => {
          testBtn.textContent = '测试连接';
          testBtn.classList.remove('btn-success', 'btn-error');
        }, 2500);
      } else {
        testBtn.textContent = '连接失败';
        testBtn.classList.add('btn-error');
        apiKeyError.textContent = response?.error || '翻译接口返回异常';
        
        setTimeout(() => {
          testBtn.textContent = '测试连接';
          testBtn.classList.remove('btn-success', 'btn-error');
        }, 3000);
      }
    });
  });

  // 4. 保存设置
  saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    let modelName = modelNameInput.value.trim();
    if (!modelName) {
      modelName = 'MiniMax-M2.7';
      modelNameInput.value = modelName;
    }

    saveBtn.setAttribute('disabled', 'true');
    saveBtn.textContent = '正在保存...';

    chrome.storage.local.set({ apiKey, modelName }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        saveBtn.textContent = '保存失败';
        saveBtn.removeAttribute('disabled');
        apiKeyError.textContent = '保存设置失败，请重试';
        return;
      }
      saveBtn.textContent = '✓ 保存成功';
      setTimeout(() => {
        saveBtn.removeAttribute('disabled');
        saveBtn.textContent = '保存设置';
      }, 1500);
    });
  });

  // 5. 翻译当前页面
  translateBtn.addEventListener('click', () => {
    chrome.storage.local.get('apiKey', (result) => {
      if (!result.apiKey) {
        apiKeyInput.classList.add('error');
        apiKeyError.textContent = '请先配置 API Key';
        setTimeout(() => {
          apiKeyInput.classList.remove('error');
          apiKeyError.textContent = '';
        }, 3000);
        return;
      }

      if (activeTabId !== null) {
        const pageMsg: ExtensionToContentMessage = { action: 'translatePage' };
        chrome.tabs.sendMessage(activeTabId, pageMsg, () => {
          const err = chrome.runtime.lastError;
          if (err) console.warn('[Popup] 发送翻译指令失败:', err.message);
          window.close();
        });
      }
    });
  });

  // 6. 恢复原文
  restoreBtn.addEventListener('click', () => {
    if (activeTabId !== null) {
      const restoreMsg: ExtensionToContentMessage = { action: 'restorePage' };
      chrome.tabs.sendMessage(activeTabId, restoreMsg, () => {
        const err = chrome.runtime.lastError;
        if (err) console.warn('[Popup] 发送恢复指令失败:', err.message);
        window.close();
      });
    }
  });
});
