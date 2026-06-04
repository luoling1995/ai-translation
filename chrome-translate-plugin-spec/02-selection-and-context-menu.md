# 划词翻译与右键菜单

> 版本：v1.3 | 日期：2026-06-03

> 返回总览：[chrome-translate-plugin-spec.md](../chrome-translate-plugin-spec.md)
>
> 适用任务：T02、T03、T07

---

### 2.1 划词翻译

#### 触发条件

- 用户在网页中用鼠标选中文本，松开鼠标（mouseup）后触发检测
- **必须满足以下全部条件**才显示翻译按钮：
  1. 选中文本长度 ≥ 1 个字符（去除首尾空白后）
  2. 选中文本长度 ≤ 5000 个字符
  3. 选中文本不全是空白字符
- 整页翻译进行中也允许划词翻译。划词翻译使用独立浮窗和独立请求状态，不与整页翻译共用进度条。

#### 翻译按钮

- **外观**：一个圆形半透明图标按钮，内部显示翻译图标（使用 SVG 内联，不依赖外部图片），直径 32px
- **位置**：出现在选区的右下角，距离选区末尾 8px
- **定位计算**：优先使用 `range.getClientRects()` 的最后一个非空 rect 作为选区末尾位置；如果没有可用 rect，再退回 `range.getBoundingClientRect()`。按钮 `position: fixed`，初始位置为 `left = rect.right + 8`，`top = rect.bottom - 16`
- **边界处理**：对按钮坐标做视口约束。右侧溢出时改为 `left = rect.left - 40`，底部溢出时改为 `top = rect.top - 40`；最终 `left/top` 仍需 clamp 到 `[8, window.innerWidth - 40]` 和 `[8, window.innerHeight - 40]`
- **消失时机**：用户点击页面其他区域（非按钮、非浮窗）时移除按钮
- **防重复**：每次 mouseup 先移除已有的翻译按钮和浮窗，再判断是否需要显示新的

#### 翻译浮窗

- **触发**：用户点击翻译按钮后显示
- **位置**：出现在翻译按钮的下方，`position: fixed`
- **尺寸**：最小宽度 300px，最大宽度 500px，最大高度 400px（超出滚动）
- **内容区域（从上到下）**：
  1. **标题栏**：左侧显示"翻译结果"四个字，右侧显示关闭按钮（×）
  2. **原文区域**：灰色背景，显示原始选中文本，最多显示 3 行，超出用 `...` 截断，可点击展开
  3. **分隔线**：1px 的浅灰色线
  4. **译文区域**：白色背景，显示翻译结果文本
- **加载状态**：点击翻译按钮后，浮窗立即出现，译文区域显示一个 CSS 旋转动画的加载图标 + "正在翻译..."文字
- **错误状态**：如果翻译失败，译文区域显示红色错误消息（具体错误文案见 §2.6）
- **关闭方式**（以下三种任一即可关闭）：
  1. 点击浮窗标题栏的关闭按钮（×）
  2. 按 Esc 键（监听 keydown 事件）
  3. 点击浮窗和翻译按钮以外的区域（监听 document 的 mousedown 事件）
- **样式隔离**：浮窗和翻译按钮必须通过 Shadow DOM 注入，避免被宿主页面 CSS 影响

#### 边界条件

| 场景 | 处理方式 |
|---|---|
| 选中文本超过 5000 字符 | 不显示翻译按钮。无任何提示（静默忽略） |
| 选中文本全是空白 | 不显示翻译按钮 |
| 在 iframe 内选中文本 | 不处理（Content Script 默认不注入 iframe，第一版不支持） |
| 用户快速连续选中不同文本 | 每次 mouseup 先清除上一次的按钮/浮窗，再显示新的 |
| 翻译请求进行中，用户又选中新文本 | 旧请求不取消（让它自然完成），但旧浮窗被移除，显示新的翻译按钮 |
| 页面滚动时浮窗位置 | 浮窗使用 `position: fixed`，滚动时保持在视口中的相对位置不变 |
| 在 input/textarea 中选中文本 | 正常处理，但不能依赖 `window.getSelection()`；需要从目标元素的 `selectionStart` / `selectionEnd` 读取选中文本 |
| 在 contenteditable 中选中文本 | 正常处理，可使用 `window.getSelection()` |

### 2.2 右键菜单翻译

#### 菜单项注册

在 Service Worker 的 `chrome.runtime.onInstalled` 事件中注册以下菜单项：

```javascript
// 菜单项1：翻译选中文本
chrome.contextMenus.create({
  id: 'translate-selection',
  title: '翻译选中文本',
  contexts: ['selection']  // 仅在有选中文本时显示
});

// 菜单项2：翻译整个页面
chrome.contextMenus.create({
  id: 'translate-page',
  title: '翻译整个页面',
  contexts: ['page']  // 在页面空白处右键时显示
});
```

#### 交互流程

- **翻译选中文本**：
  1. 用户选中文本 → 右键 → 点击"翻译选中文本"
  2. Service Worker 收到 `chrome.contextMenus.onClicked` 事件，从 `info.selectionText` 获取选中文本
  3. Service Worker 生成 `requestId`，先通过 `chrome.tabs.sendMessage` 发送加载态消息给 Content Script
  4. Content Script 在页面中心显示翻译浮窗（浮窗样式与划词翻译完全一致），译文区域显示加载状态
  5. Service Worker 调用翻译 API
  6. Service Worker 通过 `chrome.tabs.sendMessage` 将同一 `requestId` 的翻译结果或错误发送给 Content Script
  7. Content Script 仅在当前浮窗的 `requestId` 匹配时更新内容，避免旧请求覆盖新浮窗
  8. **注意**：右键菜单翻译时，浮窗位置使用页面中心位置（因为右键菜单点击后无法获取精确鼠标位置），即 `left = window.innerWidth / 2 - 浮窗宽度 / 2`，`top = window.innerHeight / 3`

- **翻译整个页面**：
  1. 用户在页面空白处右键 → 点击"翻译整个页面"
  2. Service Worker 通过 `chrome.tabs.sendMessage` 通知 Content Script 开始整页翻译
  3. Content Script 执行整页翻译逻辑（见 §2.3）

#### 边界条件

| 场景 | 处理方式 |
|---|---|
| 选中文本通过右键菜单翻译，超过 5000 字符 | 浮窗直接显示错误提示："选中文本过长，请选择不超过 5000 字符的文本" |
| 已经在进行整页翻译，又点击"翻译整个页面" | 忽略，不重复触发 |
| 右键菜单中 `info.selectionText` 为空或纯空白 | 忽略，不执行翻译 |
