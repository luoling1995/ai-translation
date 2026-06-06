# AGENTS.md

## 项目速览
- 这是 TypeScript Chrome MV3 翻译扩展；Chrome 开发者模式加载 `dist/`，不是仓库根目录。
- 规格入口是 `chrome-translate-plugin-spec.md`；开始任一 Txx 任务前只读总览里标注的关联子文档，避免一次性展开全部规格。
- 完成或调整 Txx 任务后，同步更新对应子规格和总览任务状态表；继续下一个 Txx 前先等用户允许。

## 命令
- 安装依赖：`npm install`。
- 类型检查：`npm run typecheck`。
- 完整构建：`npm run build`，实际顺序是 `typecheck -> build:background -> build:content -> build:popup`。
- 聚焦构建入口：`npm run build:background`、`npm run build:content`、`npm run build:popup`。

## 入口与边界
- `src/background.ts`：MV3 service worker、MiniMax API 适配、右键菜单、与 tab 通信。
- `src/content.ts`：内容脚本入口，负责划词翻译 UI、消息分发，并调用整页翻译模块。
- `src/popup.ts`：popup 入口，负责 API Key/模型名存储、连接测试、翻译当前页和恢复原文按钮。
- `src/page-translator.ts`：整页文本收集、token 估算分批、3 路并发翻译、译文缓存、丢项补翻译、溢出修复、原文恢复、MutationObserver 动态翻译；避免在新增循环里逐节点发 HTTP。
- `src/progress-ui.ts` 和内容脚本注入 UI 都依赖 closed Shadow DOM；宿主元素 id 保持 `ai-translate-` 前缀，供自身 DOM 过滤使用。
- `src/messaging.ts` 集中处理 `chrome.runtime.lastError` 和扩展上下文失效；新增跨脚本通信时优先复用这里的安全发送逻辑。

## 构建产物与静态文件
- esbuild 只从 `src/background.ts`、`src/content.ts`、`src/popup.ts` 打包到 `dist/*.js`，这些 JS 和 sourcemap 被 `.gitignore` 忽略。
- `dist/manifest.json`、`dist/content.css`、`dist/popup/popup.html`、`dist/popup/popup.css`、`dist/icons/` 是手工维护文件，不会由构建脚本生成。
- 运行时脚本必须是无模块 IIFE；不要让编译产物保留运行时 `import` / `export`。`src/types.ts` 只作为类型来源导入。

## 验证
- 改动任何代码都必须跑 `npm run build`（已包含 `typecheck` + 三个入口的 esbuild 打包）。
- 发布或功能验证按 `chrome-translate-plugin-spec/08-validation-and-roadmap.md`，并在 Chrome 中加载 `dist/` 手工验证受影响流程。
