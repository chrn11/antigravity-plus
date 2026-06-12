# Antigravity BYOK 代理

为 Antigravity IDE 提供 BYOK（Bring Your Own Key）本地代理服务，将 Google AI 请求重定向到 DeepSeek API。

## 原理

- 通过 hosts 文件将 Google AI 域名劫持到 `127.0.0.1`
- 在本地 `127.0.0.1:443` 运行 HTTPS MITM 代理
- 拦截 AI 请求（`streamGenerateContent` 等）并转换为 OpenAI 格式调用 DeepSeek
- 非 AI 请求通过 mihomo SOCKS5 隧道转发到真实 Google 服务器

## 文件说明

| 文件 | 说明 |
|------|------|
| `antigravity-proxy-bg.exe` | 后台运行版（无控制台窗口，日常使用） |
| `antigravity-proxy.exe` | 控制台版（带日志输出，调试使用） |
| `开始.bat` | 以管理员权限启动代理 |
| `停止.bat` | 停止代理 |
| `安装.bat` | 安装到 `D:\soft\antigravity-plus` 并创建快捷方式 |

## 快速使用

1. **准备 API Key**

   在 `%APPDATA%\antigravity-plus\` 目录下创建 `deepseek.key` 文件，写入你的 DeepSeek API Key。

2. **首次安装**

   右键 `安装.bat` → 以管理员身份运行。

3. **启动代理**

   右键 `开始.bat` → 以管理员身份运行。

4. **启动 Antigravity**

   代理启动后，打开 Antigravity IDE 即可使用 AI 功能。

5. **停止代理**

   右键 `停止.bat` → 以管理员身份运行。

## 日志

日志文件位于：`%TEMP%\antigravity-proxy.log`

## 配置

配置文件位于：`%APPDATA%\antigravity-plus\config.json`

首次运行会自动创建默认配置，包含模型映射规则。

## 模型映射

| Antigravity 模型 | DeepSeek 模型 | 是否思考 |
|---|---|---|
| Claude Opus 4.6 (Thinking) | deepseek-v4-pro | 是 |
| Claude Sonnet 4.6 (Thinking) | deepseek-v4-pro | 是 |
| Claude Haiku 4.5 (Thinking) | deepseek-v4-flash | 否 |
| Claude Opus 4.6 | deepseek-v4-pro | 是 |
| Claude Sonnet 4.6 | deepseek-v4-pro | 是 |
| Claude Haiku 4.5 | deepseek-v4-flash | 否 |
| Gemini 2.5/3.1 Pro | deepseek-v4-pro | 是 |
| Gemini 2.5/3.1 Flash | deepseek-v4-flash | 否 |

## 依赖

- mihomo（Clash）代理需运行在 `127.0.0.1:7890` 并提供 SOCKS5 混合端口
- Antigravity 2.0

## 注意事项

- 必须以管理员权限运行，否则无法修改 hosts 文件和安装 CA 证书
- 停止代理时会自动恢复 hosts 文件
- 若开机自启，请在 `安装.bat` 中输入 `y` 确认

## 免责声明

本项目的全部代码（包括架构设计、协议转换、前端界面等）**纯由 AI（Claude/Cursor Agent）从零到一自动生成**，仅经过人工需求描述和功能确认。作者对代码质量、安全性或适用性不作任何明示或暗示的保证。使用本软件所产生的一切风险由使用者自行承担。

## 参考

本项目的实现参考了以下优秀开源项目和研究：

- **[Cursor助手](https://dcne38qm5vlg.feishu.cn/wiki/K2YHwSbAjilCZ6k3ywQcHnxFn7e)** — 基于 Wails v3 的跨平台 Cursor IDE 本地代理服务，提供了 MITM 代理、BYOK 模型网关等完整架构参考
- **[白帽酱](https://rce.moe/)** — Cursor 协议逆向研究（[Cursor 逆向笔记](https://rce.moe/2026/01/31/cursor-reverse-notes-1/)），为理解 Antigravity 的 API 通信协议提供了重要基础
- **DeepSeek** — 提供高性能的 API 服务，支持 OpenAI 兼容的函数调用和思考模式
- **mihomo (Clash Meta)** — 本地透明代理，用于非 AI 请求的 SOCKS5 隧道转发
