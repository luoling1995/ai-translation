# 构建、Manifest 与样式隔离

> 版本：v1.5 | 日期：2026-08-10

> 返回总览：[chrome-translate-plugin-spec.md](../chrome-translate-plugin-spec.md)
>
> 适用任务：T00、T03、T04、T06、T08

---

### 3.1 技术栈

| 维度 | 选择 | 理由 |
|---|---|---|
| Manifest 版本 | V3 | V2 已废弃 |
| 语言 | TypeScript | 消息协议和 API 响应有明确结构，类型约束能避免字段名拼写错误等低级 bug |
| 构建工具 | esbuild + tsc | esbuild 将每个入口打包成无运行时 `import/export` 的单文件脚本，避免 Chrome Content Script 和 MV3 Service Worker 的模块加载问题；tsc 负责类型检查 |
| 样式 | 原生 CSS + Shadow DOM | Shadow DOM 隔离样式，防止与宿主页面冲突 |
| 存储 | chrome.storage.local | API Key 属于敏感凭据，默认不跨设备同步 |

### 3.2 文件结构

```
ai-translate/
├── src/                        # TypeScript 源码目录
│   ├── background.ts           # Service Worker — API 调用、右键菜单
│   ├── content.ts              # 内容脚本 — 划词检测、浮窗、整页翻译、MutationObserver
│   ├── popup.ts                # 弹出页逻辑
│   └── types.ts                # 共用类型定义（消息协议、API 响应、存储结构等）
├── dist/                       # tsc 编译输出目录（Chrome 加载此目录）
│   ├── background.js           # 编译产物（git忽略）
│   ├── content.js              # 编译产物（git忽略）
│   ├── popup.js                # 编译产物（git忽略）
│   ├── types.js                # 编译产物（git忽略）
│   ├── manifest.json           # 手动维护，直接放在 dist 中
│   ├── content.css             # 手动维护，直接放在 dist 中
│   ├── popup/
│   │   ├── popup.html          # 手动维护
│   │   └── popup.css           # 手动维护
│   └── icons/
│       ├── icon16.png
│       ├── icon32.png
│       ├── icon48.png
│       └── icon128.png
├── tsconfig.json               # TypeScript 类型检查配置
├── package.json                # 项目配置
└── .gitignore                  # 忽略 dist/*.js
```

#### 构建说明

**tsconfig.json 配置**：
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "node",
    "noEmit": true,
    "declaration": false
  },
  "include": ["src/**/*.ts"]
}
```

**package.json 脚本**：
```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "npm run typecheck && npm run build:background && npm run build:content && npm run build:popup",
    "build:background": "esbuild src/background.ts --bundle --format=iife --target=chrome114 --outfile=dist/background.js --sourcemap",
    "build:content": "esbuild src/content.ts --bundle --format=iife --target=chrome114 --outfile=dist/content.js --sourcemap",
    "build:popup": "esbuild src/popup.ts --bundle --format=iife --target=chrome114 --outfile=dist/popup.js --sourcemap"
  },
  "devDependencies": {
    "@types/chrome": "latest",
    "esbuild": "latest",
    "typescript": "latest"
  }
}
```

**开发命令**：
```bash
# 安装依赖
npm install --save-dev typescript esbuild @types/chrome

# 编译
npm run build

# 类型检查
npm run typecheck

# 开发时修改源码后重新打包
npm run build
```

**Chrome API 类型定义**：使用社区标准包 `@types/chrome`（DefinitelyTyped 维护），安装后 TypeScript 自动识别 `chrome.*` 全局 API 的类型。无需额外配置。

**Chrome 加载插件时加载 `dist/` 目录**，不是项目根目录。

**注意**：`manifest.json`、`content.css`、`popup/popup.html`、`popup/popup.css`、`icons/` 这些非 TypeScript 文件直接放在 `dist/` 目录中手动维护，不经过编译。`.ts` 文件由 esbuild 打包输出到 `dist/`。

**运行时模块约束**：`background.js`、`content.js`、`popup.js` 编译产物中不得保留运行时 `import/export`。`src/types.ts` 只能被其他文件通过 `import type` 引用，避免生成运行时依赖。

**manifest.json 中的脚本路径**指向编译后的 `.js` 文件（它们就在 `dist/` 根目录下）：
- `"service_worker": "background.js"`
- `"js": ["content.js"]`
- `"default_popup": "popup/popup.html"`（popup.html 中引用 `../popup.js`）

### 3.3 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                      Chrome 浏览器                        │
│                                                          │
│  ┌──────────────┐    chrome.runtime     ┌─────────────┐ │
│  │ Content Script│◄────sendMessage──────►│  Service     │ │
│  │              │                       │  Worker      │ │
│  │ · 划词检测    │                       │  (background)│ │
│  │ · 浮窗展示    │                       │              │ │
│  │ · 整页翻译    │                       │ · API 调用    │ │
│  │ · DOM 操作    │                       │ · 右键菜单    │ │
│  └──────────────┘                       └──────┬──────┘ │
│                                                │        │
│  ┌──────────────┐                              │        │
│  │ Popup Page   │    chrome.storage            │        │
│  │              │◄───────local─────────────────►│        │
│  │ · API Key    │                              │        │
│  │ · 模型名称    │                     fetch    │        │
│  │ · 触发翻译    │                              ▼        │
│  └──────────────┘                    ┌───────────────────┐│
│                                      │ MiniMax API       ││
│                                      │ api.minimax.io/v1 ││
│                                      └───────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### 3.7 manifest.json 完整配置

> 此文件放在 `dist/manifest.json`，Chrome 加载 `dist/` 目录。

```json
{
  "manifest_version": 3,
  "name": "AI 翻译助手",
  "version": "1.0.0",
  "description": "基于大语言模型的智能翻译工具，支持划词翻译和整页翻译",
  "permissions": [
    "storage",
    "activeTab",
    "contextMenus"
  ],
  "host_permissions": [
    "https://api.minimaxi.com/*",
    "https://api.minimax.io/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "css": ["content.css"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### 3.8 样式隔离策略

Content Script 注入的所有 UI 元素（翻译按钮、浮窗、进度条）**必须**通过 Shadow DOM 封装。

#### 实现方式

```typescript
// 创建 Shadow DOM 宿主
function createShadowContainer(id: string): { host: HTMLDivElement; shadow: ShadowRoot } {
  const host = document.createElement('div');
  host.id = id;  // 必须以 'ai-translate-' 前缀命名，用于 MutationObserver 过滤
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  document.body.appendChild(host);
  return { host, shadow };
}

// 在 shadow 内部插入样式和 DOM
// 所有浮窗/按钮的 CSS 都写在 shadow 内部的 <style> 标签中
// 不依赖外部 content.css 来给浮窗设置样式
```

#### 要点

- 使用 `mode: 'closed'` 防止宿主页面脚本访问内部 DOM
- 宿主元素设置 `all: initial` 重置所有继承样式
- 宿主元素设置 `z-index: 2147483647` 确保在最顶层
- 每种 UI 组件（翻译按钮、浮窗、进度条）使用独立的 Shadow DOM 宿主
- **所有宿主元素的 `id` 必须以 `ai-translate-` 前缀命名**（如 `ai-translate-button`、`ai-translate-popup`、`ai-translate-progress`），用于 MutationObserver 过滤自身注入的元素
- `content.css` 文件仅用于设置宿主元素的最基本定位样式，浮窗内部样式全部写在 Shadow DOM 的 `<style>` 中

### 3.9 图标方案

第一版使用程序生成的简单 SVG 图标（不依赖外部图片文件）：

- **翻译按钮图标**：在 content.ts 中使用内联 SVG，绘制一个简单的"译"字或地球+文字图标
- **插件工具栏图标**（icons 目录下的 png 文件）：使用 canvas 绘制简单的彩色字母图标并导出为 png，或者直接使用一个 SVG 转 png 工具生成。**第一版可以用纯色方块 + 文字作为占位图标**

---
