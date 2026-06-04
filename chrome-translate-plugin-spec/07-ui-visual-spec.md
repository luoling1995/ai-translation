# UI 视觉规范

> 版本：v1.3 | 日期：2026-06-03

> 返回总览：[chrome-translate-plugin-spec.md](../chrome-translate-plugin-spec.md)
>
> 适用任务：T03、T04、T06

---

## 四、UI 视觉规范

### 配色方案

| 用途 | 颜色值 | 说明 |
|---|---|---|
| 主色 | `#4F46E5` | 靛蓝色，用于按钮、链接、进度条 |
| 主色悬停 | `#4338CA` | 主色加深 |
| 成功色 | `#10B981` | 绿色，用于成功提示 |
| 错误色 | `#EF4444` | 红色，用于错误提示 |
| 背景色（浮窗） | `#FFFFFF` | 白色 |
| 背景色（原文区） | `#F9FAFB` | 浅灰色 |
| 文字色 | `#1F2937` | 深灰色 |
| 次要文字色 | `#6B7280` | 灰色 |
| 边框色 | `#E5E7EB` | 浅灰色 |
| 进度条背景 | `rgba(0, 0, 0, 0.85)` | 半透明黑色 |

### 字体

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
```

### 圆角

- 浮窗：`border-radius: 12px`
- 按钮：`border-radius: 8px`
- 翻译图标按钮：`border-radius: 50%`（圆形）
- 输入框：`border-radius: 8px`

### 阴影

- 浮窗：`box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)`
- 翻译按钮：`box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15)`

---
