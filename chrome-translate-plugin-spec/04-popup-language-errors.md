# Popup、语言策略与错误处理

> 版本：v1.6 | 日期：2026-08-10

> 返回总览：[chrome-translate-plugin-spec.md](../chrome-translate-plugin-spec.md)
>
> 适用任务：T06、T07

---

### 2.4 设置页面（Popup）

#### 布局（从上到下）

1. **标题区**：插件名称 "AI 翻译助手"，带小 logo
2. **API 设置区**：
   - **API Key 输入框**：`type="password"`，placeholder 显示"请输入 MiniMax API Key"
   - **模型选择输入框**：普通文本输入框，`type="text"`，placeholder 显示"MiniMax-M2.7"，用户可手动输入任意模型名。如果用户不填写，使用默认值 `MiniMax-M2.7`
    - **测试连接按钮**：点击后使用输入框当前的 API Key 和模型名调用 API 发送一个简单测试消息（"请回复 ok"），无需先保存；成功则按钮变绿并显示"✓ 连接成功"，失败则变红并显示具体错误
   - **保存按钮**：保存 API Key 和模型名到 `chrome.storage.local`
3. **操作区**：
   - **翻译当前页面**按钮：点击后发送消息给当前 tab 的 Content Script 开始整页翻译，同时关闭 Popup
   - **恢复原文**按钮：Popup 打开时向当前 tab 发送 `getPageState` 查询状态；当 `isPageTranslated === true` 时可点击，否则 disabled
4. **状态区**：显示当前配置状态，如"已配置 API Key"或"未配置 API Key"

#### 数据存储

```javascript
// chrome.storage.local 中存储的数据结构
{
  "apiKey": "用户的 API Key 字符串",
  "modelName": "MiniMax-M2.7"  // 默认值，用户可修改
}
```

#### 边界条件

| 场景 | 处理方式 |
|---|---|
| API Key 为空时点击"测试连接" | 输入框边框变红，下方显示"请先输入 API Key" |
| API Key 为空时点击"翻译当前页面" | 弹出提示"请先配置 API Key" |
| 测试连接超时 | 10 秒超时，显示"连接超时，请检查网络" |
| 测试连接返回非 200 状态码 | 显示"连接失败：HTTP {状态码}"，如果是 401 则显示"API Key 无效" |
| Popup 页面打开时 | 自动从 `chrome.storage.local` 读取已保存的 API Key（显示为密码掩码）和模型名并填充到输入框 |
| 模型名输入框为空时保存 | 使用默认值 "MiniMax-M2.7"，不报错 |
| 保存配置失败 | 显示“保存失败”，不得显示成功状态 |
| 当前页面无法注入 Content Script | 翻译当前页面和恢复原文按钮不可用，状态区显示"当前页面不支持翻译" |

### 2.5 语言检测策略

- 不依赖外部语言检测 API
- 在翻译 prompt 中让大模型自动识别源语言并翻译为中文
- 如果内容本身已经是中文，大模型返回原文即可（在 prompt 中说明）
- **整页翻译的前置过滤**：在发送给 API 之前，Content Script 已经通过中文字符占比过滤掉了中文文本（见 §2.3 文本节点收集规则），因此 API 收到的基本都是需要翻译的外文

### 2.6 错误处理统一规范

所有翻译失败场景的用户提示文案：

| 错误类型 | 用户看到的提示 |
|---|---|
| 未配置 API Key | "请先在插件设置中配置 API Key" |
| API 返回 401 Unauthorized | "API Key 无效，请检查设置" |
| API 返回 429 Too Many Requests | "请求过于频繁，请稍后再试" |
| API 返回 500/502/503 | "翻译服务暂时不可用，请稍后再试" |
| API 返回 529 | "翻译服务繁忙，请稍后再试" |
| API 返回其他非 200 状态码 | "翻译失败（错误码：{statusCode}）" |
| 网络错误（fetch 抛出 TypeError） | "网络连接失败，请检查网络" |
| 请求超时（30 秒） | "翻译请求超时，请稍后再试" |
| API 响应 JSON 解析失败 | "翻译服务返回了无效的响应" |
| API 响应中无 choices 或 choices 为空 | "翻译服务返回了空结果，请重试" |

---
