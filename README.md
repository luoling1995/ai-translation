# AI 翻译助手

基于 MiniMax 大模型的 Chrome MV3 翻译扩展，支持划词翻译、右键菜单翻译、整页翻译和动态内容自动翻译。扩展自动识别源语言，并统一翻译为简体中文。

## 功能特性
- 划词后在选区附近显示翻译按钮，点击后在页面浮窗展示译文。
- 右键菜单支持“翻译选中文本”和“翻译整个页面”。
- Popup 支持保存 MiniMax API Key、配置模型名、测试连接、触发整页翻译和恢复原文。
- 整页翻译按批次请求，避免逐节点调用 HTTP；翻译完成后可继续监听并翻译动态加载内容。
- 内容脚本注入 UI 使用 closed Shadow DOM 隔离样式，减少宿主页面 CSS 影响。

## 安装与加载
1. 安装依赖：`npm install`。
2. 构建扩展：`npm run build`。
3. 打开 Chrome 的 `chrome://extensions/`。
4. 开启“开发者模式”。
5. 点击“加载已解压的扩展程序”，选择本仓库的 `dist/` 目录。

Chrome 加载的是 `dist/`，不是仓库根目录。

## 配置与使用
1. 点击浏览器工具栏中的扩展图标。
2. 输入 MiniMax API Key。
3. 按需修改模型名；留空保存时默认使用 `MiniMax-M2.7`。
4. 点击“测试连接”确认 API 可用。
5. 在网页中划词点击翻译按钮，或使用右键菜单和 Popup 触发页面翻译。

Chrome 受限页面（如 `chrome://`、Chrome Web Store、扩展页面）通常无法注入内容脚本，页面翻译功能不可用。

## 开发命令
- `npm install`：安装依赖。
- `npm run typecheck`：运行 TypeScript 类型检查。
- `npm run build`：完整构建，顺序为 `typecheck -> build:background -> build:content -> build:popup`。
- `npm run build:background`：只打包 MV3 service worker。
- `npm run build:content`：只打包内容脚本。
- `npm run build:popup`：只打包 Popup 脚本。

## 目录说明
- `src/background.ts`：MV3 service worker、MiniMax API 适配、右键菜单、与 tab 通信。
- `src/content.ts`：内容脚本入口，负责划词翻译 UI、消息分发，并调用整页翻译模块。
- `src/popup.ts`：Popup 入口，负责 API Key/模型名存储、连接测试、翻译当前页和恢复原文按钮。
- `src/page-translator.ts`：整页文本收集、分批翻译、原文恢复、MutationObserver 动态翻译。
- `src/progress-ui.ts`：整页翻译进度条 UI。
- `src/messaging.ts`：安全消息发送、`chrome.runtime.lastError` 和扩展上下文失效处理。
- `src/types.ts`：消息协议、API 响应、存储结构等共享类型。
- `dist/manifest.json`、`dist/content.css`、`dist/popup/popup.html`、`dist/popup/popup.css`、`dist/icons/`：手工维护的扩展静态文件。

## 构建产物说明
esbuild 只从 `src/background.ts`、`src/content.ts`、`src/popup.ts` 打包到 `dist/*.js`。这些 JS 和 sourcemap 被 `.gitignore` 忽略，运行时必须是无模块 IIFE，不能保留运行时 `import` / `export`。

`dist/manifest.json` 和 Popup HTML/CSS 等静态文件不会由构建脚本生成，修改扩展清单或静态 UI 时需要直接维护这些文件。

## 验证
- 修改 TypeScript 后至少运行：`npm run typecheck`。
- 修改入口、消息协议、manifest 或静态扩展文件后运行：`npm run build`。
- 手工验证按 `chrome-translate-plugin-spec/08-validation-and-roadmap.md` 执行，并在 Chrome 中加载 `dist/` 测试受影响流程。

## 规格文档
- 总览入口：`chrome-translate-plugin-spec.md`。
- 子规格目录：`chrome-translate-plugin-spec/`。

继续开发 Txx 任务前，先按总览读取对应子规格；完成或调整任务后，同步更新规格和总览任务状态表。
