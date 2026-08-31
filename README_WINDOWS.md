# QuecPi H1 VS Code 插件 — Windows 版

> 工程路径: `D:\MyProject\vs_code_quecpi`（Visual Studio 工程管理）
> 从 WSL2 版 `vscode-quecpi` 派生，**Windows 版保留调试/烧录/抓日志，禁用固件构建**。

## 一、Windows 版能力（vs WSL2 版）

| 功能 | Windows 版 | 说明 |
|---|---|---|
| 固件构建 (bitbake) | ❌ 禁用 | Windows 无 docker 构建环境；按钮置灰并提示「在 WSL/Linux 构建」 |
| 设备调试 (adb) | ✅ | 用 Windows `platform-tools\adb.exe`（板子 USB 接 Windows 时） |
| 烧录 (QDL) | ✅ | 用 Windows `QDL_Win_x64\QDL.exe`（EDL 模式） |
| 串口监视 | ✅ | PowerShell COM 端口终端（选 COMx） |
| 抓日志 (dmesg/journalctl) | ✅ | 经 adb |
| AI Chat | ✅ | 直连 DeepSeek Harness |
| 控制面板 | ✅ | 同 WSL 版 UI（构建区置灰） |

## 二、Visual Studio 工程

```
D:\MyProject\vs_code_quecpi\
├── vs_code_quecpi.sln        ← VS 解决方案
├── vs_code_quecpi.vcxproj    ← 构建工程（npm → tsc → vsce 打包）
├── package.json / tsconfig.json
├── src\                      ← 插件源码（Windows 适配版）
├── webview\                  ← 面板资源
└── dist\vscode-quecpi-win.vsix  ← 打包产物
```

**构建**：用 Visual Studio 打开 `vs_code_quecpi.sln` → 右键项目 → **生成（Build）**
→ 自动执行 `npm install` → `npm run compile` → `npx vsce package` → 产出 `dist\vscode-quecpi-win.vsix`。

> 也可命令行构建：`msbuild vs_code_quecpi.vcxproj /p:Configuration=Release`

## 三、Windows 版配置（VS Code 设置）

| 设置 | Windows 版值 | 说明 |
|---|---|---|
| `quecpi.flash.qdlPath` | `D:\Pi-SG565D\Tools+Driver\QDL_Win_x64\QDL.exe` | Windows QDL 烧录工具 |
| `quecpi.adb.path` | `D:\Pi-SG565D\tools_website_new\platform-tools\adb.exe` | Windows adb |
| `quecpi.serial.port` | 选 COM 口（弹窗选择） | 板子 UART COM 端口 |
| `quecpi.harness.url` | `http://127.0.0.1:3080` | AI Chat 后端 |

## 四、Windows 版 vs WSL2 版分工

| 场景 | 用哪个版本 |
|---|---|
| 固件构建 / 烧录 / 设备调试 | **WSL2 版**（板子 USB 转发进 WSL） |
| 纯调试 / 看日志 / AI（不开 WSL） | **Windows 版**（板子 USB 在 Windows） |
| 镜像下载烧录 | 两版都行（Windows 用 QDL.exe，WSL 用 qdl） |

## 五、平台适配说明（代码层）

- `src/config.ts` → `isWindows = process.platform === 'win32'`
- `src/extension.ts` → `winGuard()` 拦截全部 build 类命令（Windows 弹提示）
- `src/panel/panelCore.ts` → Windows 下构建区标题提示 + 5 个构建 tile 置灰
- `src/serial.ts` → Windows 分支：PowerShell `System.IO.Ports.SerialPort` 打开 COM 口
- `src/flash.ts` → `qdlPath` 指向 Windows QDL.exe（`LD_LIBRARY_PATH` 逻辑对 Windows 无害）
