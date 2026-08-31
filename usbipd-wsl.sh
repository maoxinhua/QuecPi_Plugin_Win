#!/bin/bash
# ============================================================================
# QuecPi USB 转发管理 (usbipd-win <-> WSL2)
# 用途: 把 Windows 宿主机上连接的 Quectel-Pi 板子 USB 设备转发到 WSL2,
#       让 WSL2 里的 adb / 串口 / qdl 能直接操作开发板。
# 用法:
#   ./usbipd-wsl.sh status    查看转发状态
#   ./usbipd-wsl.sh attach    附加板子(adb 模式)到 WSL  [会弹 UAC]
#   ./usbipd-wsl.sh detach    从 WSL 分离(还给 Windows)
#   ./usbipd-wsl.sh edl       附加 EDL 模式设备(烧录用)  [会弹 UAC]
# 注意: 每个操作都会弹出 Windows UAC 窗口, 需要点「是」。
#       板子进 EDL 后 VID:PID 变为 05c6:9008/900e, 需要单独 attach。
# ============================================================================
set -e
USBIPD="/mnt/c/Program Files/usbipd-win/usbipd.exe"
ADB_MODE_PID="05c6:902d"    # 板子 adb/Android 模式
EDL_MODE_PID="05c6:9008"    # 板子 EDL 模式 (强制下载)

run_admin() {
  # 以管理员运行 usbipd 命令 (触发 UAC)
  powershell.exe -NoProfile -Command \
    "Start-Process -FilePath 'C:\Program Files\usbipd-win\usbipd.exe' -ArgumentList '$1' -Verb RunAs -Wait" 2>/dev/null
  sleep 3
}

find_busid() {
  local pid="$1"
  "$USBIPD" list 2>/dev/null | grep -i "$pid" | awk '{print $1}' | head -1
}

case "$1" in
  status)
    echo "=== usbipd 转发状态 ==="
    "$USBIPD" list 2>/dev/null
    echo
    echo "=== WSL 内可见 ==="
    echo -n "adb: "; adb devices 2>/dev/null | grep -c "device$" | xargs echo "设备数"
    ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || echo "串口: 无"
    ;;
  attach)
    echo ">>> 附加板子 (adb 模式) 到 WSL ..."
    # 先释放 Windows 侧占用 (adb server)
    adb kill-server 2>/dev/null || true
    BID=$(find_busid "$ADB_MODE_PID")
    if [ -z "$BID" ]; then echo "❌ 未找到板子设备 ($ADB_MODE_PID)"; exit 1; fi
    run_admin "bind --busid $BID"
    run_admin "attach --wsl --busid $BID"
    echo "✅ 已附加 (busid $BID)"
    sleep 3; adb devices
    ;;
  detach)
    BID=$(find_busid "$ADB_MODE_PID")
    [ -z "$BID" ] && BID=$(find_busid "$EDL_MODE_PID")
    if [ -z "$BID" ]; then echo "❌ 未找到已附加的板子设备"; exit 1; fi
    run_admin "detach --busid $BID"
    echo "✅ 已分离 (busid $BID)"
    ;;
  edl)
    echo ">>> 附加 EDL 模式设备 (烧录用) ..."
    adb kill-server 2>/dev/null || true
    BID=$(find_busid "$EDL_MODE_PID")
    if [ -z "$BID" ]; then
      echo "❌ 未找到 EDL 设备 ($EDL_MODE_PID)"
      echo "   请先执行: adb shell reboot edl  (或按住音量上键上电)"
      exit 1
    fi
    run_admin "bind --busid $BID"
    run_admin "attach --wsl --busid $BID"
    echo "✅ EDL 设备已附加 (busid $BID) — 现在可以跑 qdl 烧录"
    ;;
  *)
    echo "用法: $0 {status|attach|detach|edl}"
    ;;
esac
