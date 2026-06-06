# Chrome 大模型翻译插件规格总览

> 版本：v1.4 | 日期：2026-06-06

> 本文件是 AI 和开发者的入口导航。具体规格已经拆分到 `chrome-translate-plugin-spec/` 目录。
>
> 每完成一个任务，必须回到本文件更新“任务状态表”的状态、完成日期和备注。

---

## 一、如何使用这组文档

1. 先读本总览，确认任务状态和执行顺序。
2. 开始某个任务前，只读取任务关联的子文档，避免一次加载全部规格。
3. 实现过程中如果发现规格需要调整，先更新对应子文档，再同步更新本总览。
4. 完成任务后，把任务状态从 `未开始` 或 `进行中` 改为 `已完成`，填写完成日期和关键备注。
5. 如果任务被推迟或不做，状态改为 `阻塞` 或 `跳过`，并在备注里写明原因。
6. 完成 Txx 后更新总览，并告诉我验证结果，经过我的允许之后，才能继续下一个Txx任务。

---

## 二、文档地图

| 文档 | 内容 | 主要任务 |
|---|---|---|
| [01-project-overview.md](chrome-translate-plugin-spec/01-project-overview.md) | 项目定位、范围、核心约束 | T00、T08 |
| [02-selection-and-context-menu.md](chrome-translate-plugin-spec/02-selection-and-context-menu.md) | 划词翻译、右键菜单翻译、对应边界条件 | T02、T03、T07 |
| [03-page-translation.md](chrome-translate-plugin-spec/03-page-translation.md) | 整页翻译、恢复原文、取消翻译、动态内容自动翻译 | T04、T05、T07 |
| [04-popup-language-errors.md](chrome-translate-plugin-spec/04-popup-language-errors.md) | Popup 设置页、语言检测策略、统一错误文案 | T06、T07 |
| [05-build-manifest-and-ui-isolation.md](chrome-translate-plugin-spec/05-build-manifest-and-ui-isolation.md) | 技术栈、文件结构、构建、Manifest、Shadow DOM、图标 | T00、T03、T04、T06、T08 |
| [06-message-protocol-and-api.md](chrome-translate-plugin-spec/06-message-protocol-and-api.md) | 消息协议、异步响应规则、MiniMax API 适配 | T01、T02、T04、T05、T06、T07 |
| [07-ui-visual-spec.md](chrome-translate-plugin-spec/07-ui-visual-spec.md) | 颜色、字体、圆角、阴影等视觉规范 | T03、T04、T06 |
| [08-validation-and-roadmap.md](chrome-translate-plugin-spec/08-validation-and-roadmap.md) | 开发验证计划、后续迭代方向 | T08 |

---

## 三、推荐执行顺序

1. T00 项目初始化和构建骨架
2. T01 类型定义和消息协议
3. T02 Background/API/右键菜单
4. T03 划词翻译和浮窗
5. T04 整页翻译、取消和恢复
6. T05 动态内容自动翻译
7. T06 Popup 设置页和页面操作
8. T07 错误处理和受限页面兼容
9. T08 验证、整理和发布前检查

---

## 四、任务状态表

状态枚举：`未开始`、`进行中`、`已完成`、`阻塞`、`跳过`。

| 任务 ID | 任务 | 状态 | 关联文档 | 完成日期 | 备注 |
|---|---|---|---|---|---|
| T00 | 项目初始化、目录结构、构建脚本、Manifest、图标占位 | 已完成 | [01](chrome-translate-plugin-spec/01-project-overview.md)、[05](chrome-translate-plugin-spec/05-build-manifest-and-ui-isolation.md) | 2026-06-04 | 目录结构已搭建，依赖已安装，编译和打包已成功运行 |
| T01 | 共用类型、消息协议、异步响应规则 | 已完成 | [06](chrome-translate-plugin-spec/06-message-protocol-and-api.md) | 2026-06-04 | 完成类型定义，搭建好通信协议骨架，实现异步 return true 响应 |
| T02 | Service Worker、MiniMax API 适配、右键菜单 | 已完成 | [02](chrome-translate-plugin-spec/02-selection-and-context-menu.md)、[06](chrome-translate-plugin-spec/06-message-protocol-and-api.md) | 2026-06-04 | 成功适配 MiniMax API，支持单条与批量翻译及超时校验，完成右键菜单注册与交互分发 |
| T03 | 划词检测、翻译按钮、翻译浮窗、Shadow DOM 样式 | 已完成 | [02](chrome-translate-plugin-spec/02-selection-and-context-menu.md)、[05](chrome-translate-plugin-spec/05-build-manifest-and-ui-isolation.md)、[07](chrome-translate-plugin-spec/07-ui-visual-spec.md) | 2026-06-04 | 划词与 input 兼容成功，利用 closed Shadow DOM 实现按钮及浮窗的样式完全隔离，支持原文展开折叠及多种关闭方式 |
| T04 | 整页文本收集、分批翻译、进度条、取消、恢复原文 | 已完成 | [03](chrome-translate-plugin-spec/03-page-translation.md)、[05](chrome-translate-plugin-spec/05-build-manifest-and-ui-isolation.md)、[06](chrome-translate-plugin-spec/06-message-protocol-and-api.md)、[07](chrome-translate-plugin-spec/07-ui-visual-spec.md) | 2026-06-04 | 成功实现多标签/样式过滤、字符及段数限制分批打包、置顶 Shadow 进度条、以及翻译中途取消与一键恢复机制 |
| T05 | MutationObserver 动态内容自动翻译 | 已完成 | [03](chrome-translate-plugin-spec/03-page-translation.md)、[06](chrome-translate-plugin-spec/06-message-protocol-and-api.md) | 2026-06-04 | 成功实现 MutationObserver 动态增量文本监听与翻译，支持 500ms 积压防抖与 isAutoTranslating 并发锁，无死循环问题 |
| T06 | Popup API Key、模型名、测试连接、翻译当前页、恢复原文 | 已完成 | [04](chrome-translate-plugin-spec/04-popup-language-errors.md)、[06](chrome-translate-plugin-spec/06-message-protocol-and-api.md)、[07](chrome-translate-plugin-spec/07-ui-visual-spec.md) | 2026-06-04 | 编写高颜值选项页 HTML/CSS，实现本地存储读写、受限页面保护检测、10s 超时测试连接和页面操作派发 |
| T07 | 统一错误处理、Chrome 受限页面、请求超时和异常兜底 | 已完成 | [02](chrome-translate-plugin-spec/02-selection-and-context-menu.md)、[03](chrome-translate-plugin-spec/03-page-translation.md)、[04](chrome-translate-plugin-spec/04-popup-language-errors.md)、[06](chrome-translate-plugin-spec/06-message-protocol-and-api.md) | 2026-06-04 | 修正并对齐 API 所有错误中文响应提示，完善全链路对受限页面 (chrome:// 等) 通信崩溃的防护 |
| T08 | 全量验证、构建产物检查、手工测试和发布前整理 | 已完成 | [01](chrome-translate-plugin-spec/01-project-overview.md)、[05](chrome-translate-plugin-spec/05-build-manifest-and-ui-isolation.md)、[08](chrome-translate-plugin-spec/08-validation-and-roadmap.md) | 2026-06-04 | 终期全量 tsc 类型检查通过，esbuild 打包无误，生成物完全符合无 module runtime 注入规范 |
| T09 | 分批策略优化、并发翻译、翻译缓存、补翻译、溢出修复 | 已完成 | [03](chrome-translate-plugin-spec/03-page-translation.md)、[06](chrome-translate-plugin-spec/06-message-protocol-and-api.md)、[08](chrome-translate-plugin-spec/08-validation-and-roadmap.md) | 2026-06-06 | 改用 token 估算分批（上限 5000）替代字符数分批；3 路并发提速；分隔符方案替代 JSON 数组防错位；并发重试+补翻译消除丢项；内存翻译缓存；溢出容器修复；监听死节点释放内存 |

---

## 五、总览更新规则

完成任一任务后，必须更新上面的任务状态表：

```markdown
| T03 | 划词检测、翻译按钮、翻译浮窗、Shadow DOM 样式 | 已完成 | ... | 2026-06-03 | 已通过划词翻译手工验证 |
```

如果只完成一部分，把状态改为 `进行中`，并在备注里说明剩余工作。

如果实现过程中调整了规格，必须同步更新：

1. 对应子文档的具体规则。
2. 本总览的文档地图或任务备注。
3. 验证计划中的相关检查项。

---

## 六、当前拆分记录

- 2026-06-03：从单文件规格拆分为 8 个子文档，并将原文件改为 AI 导航和任务状态总览。
- 2026-06-06：同步实际代码改动至规格（v1.4）：token 估算分批、三路并发、⟪N#⟫ 分隔符方案、missedIndices 补翻译、翻译缓存、溢出修复、双 Endpoint 回退、120s 超时、防抖 2000ms。
