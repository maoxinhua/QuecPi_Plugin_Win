# QuecPi H1 DevKit — VS Code 扩展

CodeBuddy 式的 QuecPi H1（QCM6490）Qualcomm Linux BSP 构建/调试/对话插件。
可嵌入 VS Code，对 `/mnt/wsl/PHYSICALDRIVE1p1/QuecPi/QuecPi-QCLinux-BL01` 仓库做整体构建、调试，并用 AI 对话（DeepSeek 等 OpenAI 兼容 API）问答项目。

## 功能

- **快速构建**（左侧 QuecPi 视图 / 命令面板）
  - ⚙ Configure（`buildconfig QSM565DWF <rev> STD`）
  - 🚀 Build All（`buildall` → bitbake qcom-multimedia-image）
  - 🧱 Build Kernel / 📋 Build DTB / 📦 Package Images / 单个 recipe 重编
- **构建产物树**：浏览 `deploy/images/qcm6490-idp`，点开文件/复制路径
- **bitbake 日志浏览器**：列出所有 `log.do_*`，一键定位失败
- **串口监视器**：host 上的 picocom/minicom/screen 接 QuecPi 调试串口（ttyMSM0 @ 115200）
- **烧录帮助**：QDL/firehose 流程速查
- **AI Chat（CodeBuddy 式）**：WebView 对话，流式输出，可附带当前选中代码/文件/指南作为上下文，走 OpenAI 兼容 `/chat/completions`

## 安装

方式一（推荐，`.vsix`）：

```bash
# 在 Windows 侧 VS Code 里（WSL remote 需先进入 WSL）
code --install-extension vscode-quecpi-0.1.0.vsix
```

方式二（源码调试）：在 VS Code 打开本目录 → 按 `F5` 启动 Extension Development Host。

## 配置（Settings → QuecPi H1 DevKit）

| 项 | 默认 | 说明 |
|---|---|---|
| `quecpi.bspPath` | `/mnt/wsl/PHYSICALDRIVE1p1/QuecPi/QuecPi-QCLinux-BL01` | BSP 仓库路径 |
| `quecpi.build.mode` | `docker` | `docker` 用 `quecpi-build` 容器执行；`local` 直接在本 WSL 跑 |
| `quecpi.build.container` | `quecpi-build` | 容器名 |
| `quecpi.build.projectRev` | `SG565DWFPARL1A02_BL01BP01K0M02V01_QDP_LP6.6.052.01.003V07` | buildconfig 版本串 |
| `quecpi.build.custName` | `STD` | STD / DBG / SEC / STD/SEC |
| `quecpi.build.threads` | `10` | 注入 local.conf 的 `-j` 并发 |
| `quecpi.serial.port` / `baud` | `/dev/ttyUSB0` / `115200` | 串口 |
| `quecpi.chat.baseUrl` | `https://api.deepseek.com` | 对话 API 端点 |
| `quecpi.chat.apiKey` | 空 | 建议用环境变量 `QUECPI_API_KEY` / `DEEPSEEK_API_KEY` |
| `quecpi.chat.model` | `deepseek-chat` | 模型名 |

## 构建运行方式说明

`docker` 模式通过 `docker exec -u builder quecpi-build bash -lc 'cd /work && ...'` 执行，
容器需已存在并装好 Yocto 依赖（见 BUILD_DEBUG_GUIDE.md）。`local` 模式需宿主已装齐 Yocto 依赖。

## 开发

```bash
npm install
npm run compile   # tsc → out/
npm run package   # 生成 .vsix
```
