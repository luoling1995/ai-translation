# 项目概述与范围

> 版本：v1.3 | 日期：2026-06-03

> 返回总览：[chrome-translate-plugin-spec.md](../chrome-translate-plugin-spec.md)
>
> 适用任务：T00、T08

---

## 一、项目概述

开发一个 Chrome 浏览器扩展插件，利用大语言模型（MiniMax）提供网页翻译功能。相比传统翻译 API，大模型能更好地理解上下文语义，提供更自然流畅的翻译结果。

### 核心定位

- **个人使用**的翻译工具，API Key 由用户自行配置
- 自动检测源语言，**统一翻译为简体中文**
- 第一版使用 MiniMax API，支持用户自己配置 MiniMax 的各种模型（如 MiniMax-M2.7、MiniMax-M1 等），架构预留扩展其他 API 提供商的能力

---
