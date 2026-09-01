# QuecPi Pi H1 — QDL 烧录工具使用指南（Windows）

> 工具：`D:\Pi-SG565D\tools_website_new\Quectel_Pi_H1_QDL_Win_x64\`（`QDL.exe` + `libusb-1.0.dll`）
> 文档日期：2026-09-01 · 来源：linux-msm/qdl 官方 README + Quectel 官方烧录文档

---

## 1. QDL 是什么

**QDL**（Qualcomm Download）是 Qualcomm 的固件烧录命令行工具，通过 USB 与板子的
**EDL（Emergency Download）模式**通信（VID `05c6`，PID `9008` Firehose / `900e` 崩溃转储 /
`901d` / `90db`），上传 firehose 加载器后用 firehose 协议烧录镜像。

| 文件 | 作用 |
|---|---|
| `QDL.exe` | 烧录主程序（命令行，无 GUI） |
| `libusb-1.0.dll` | USB 通信运行库（与 QDL.exe 同目录） |

---

## 2. 前置条件

| 项 | 要求 |
|---|---|
| **烧录包** | `quectel_build/<rev>/` 目录，含 `prog_firehose_Qcm6490_ddr.elf` + `rawprogram*.xml` + `patch*.xml`（由 `buildpackage` 生成） |
| **板子进 EDL** | `adb shell reboot edl`（或按住音量上键上电） |
| **Windows USB 驱动** | 设备管理器应出现 `Qualcomm HS-USB QDLoader 9008`（驱动在 `D:\Pi-SG565D\Tools+Driver\`） |
| **存储类型** | Pi H1 板载 **UFS** 存储（烧录参数 `--storage ufs`） |

---

## 3. 烧录步骤

### ① 板子进 EDL 模式
```powershell
adb shell reboot edl
```
> 若 adb 不可用：断电后按住**音量上键**上电，板子直接进 EDL。

### ② 确认 Windows 识别 EDL 设备
- 设备管理器出现 `Qualcomm HS-USB QDLoader 9008`（COM 口）
- 或 PowerShell 检查：`Get-PnpDevice | Where-Object {$_.InstanceId -match '9008'}`

### ③ 进入烧录包目录
```powershell
cd <烧录包目录>
# 例：cd D:\work\quectel_build\QSM565DWFPARL1A01_BP01.001_Linux6.6.38_V01
```

### ④ 运行 QDL 烧录（UFS）
```powershell
# 单表烧录（最常用）
QDL.exe --storage ufs prog_firehose_Qcm6490_ddr.elf rawprogram0.xml patch0.xml

# 多表烧录（烧录包含多个 rawprogram/patch 时，如 6 个）
QDL.exe --storage ufs prog_firehose_Qcm6490_ddr.elf rawprogram*.xml patch*.xml
```
> Windows cmd 的 `*` 通配符会自动展开；PowerShell 下 `*` 需用 `Get-ChildItem` 展开或逐个列出完整文件名。

---

## 4. 常用选项

| 选项 | 用途 | 示例 |
|---|---|---|
| `--storage <type>` | 存储类型 `ufs\|emmc\|nand` | `--storage ufs`（Pi H1 用） |
| `--serial=<序号>` | 多板连接时指定目标板 | `--serial=0AA94EFD` |
| `--dry-run` | 预演（不实际烧录，检查参数/文件） | `--dry-run` |
| `--debug` | 输出详细调试日志 | `--debug` |
| `--allow-missing` | 允许缺失文件继续 | `--allow-missing` |
| `--help` | 查看完整帮助 | `--help` |

---

## 5. 结果判断

| 现象 | 含义 |
|---|---|
| 无报错跑完，显示完成/退出码 0 | ✅ 烧录成功，板子自动重启进新系统 |
| `Waiting for EDL device` 卡住 | ⚠️ 板子没进 EDL（检查 USB 连接 / 驱动 / 是否按住音量键） |
| `Failed to open device` | ⚠️ USB 权限/驱动问题，换 USB 口或重装驱动 |
| `--dry-run` 通过 | 参数和文件正确，可放心实烧 |

---

## 6. ⚠️ WSL2 烧录的已知风险（重要）

linux-msm/qdl 官方 README **特别警告**：WSL2 + usbipd-win 转发 EDL 设备烧录**不可靠**
（已知 bug：EDL 设备每次重进 EDL 会重新枚举、attach 会掉、BUSID 会变）。

- **结论**：**Windows 版 QDL.exe 直接在 Windows 侧烧录更稳**（板子 USB 直连 Windows，无需 usbipd）。
- 插件配置：`quecpi.flash.qdlPath` 指到 `D:\Pi-SG565D\tools_website_new\Quectel_Pi_H1_QDL_Win_x64\QDL.exe`
- EDL 设备每次重进 EDL 后需重新识别（`usbipd list` → 重新 attach）。

---

## 7. 官方参考资料

- [linux-msm/qdl — Command-line tool for flashing via EDL](https://github.com/linux-msm/qdl)
- [Quectel Pi H1 官方烧录文档（QDL 介绍和镜像烧录）](https://developer.quectel.com/doc/sbc/Quectel-Pi-H1/zh/development-guide/burn-image.html)
- [Quectel Pi H1 系统安装（Debian）](https://developer.quectel.com/doc/sbc/Quectel-Pi-H1/en/OS/Debian/system_flash.html)
- [Flashing from WSL2 (usbipd-win) — linux-msm/qdl](https://github.com/linux-msm/qdl#flashing-from-wsl2-usbipd-win)
