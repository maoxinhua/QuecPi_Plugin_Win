import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, execSync } from 'child_process';
import { Cfg, isWindows } from './config';

/**
 * Flash runner: one-click EDL flash — adb reboot edl → wait → QDL burn.
 * Platform-aware (Windows QDL.exe / Linux qdl).
 *
 * On Windows: the BSP lives on a WSL filesystem that Windows fs can't access.
 * Solution: copy the flash package to D:\quecpi-flash via `wsl bash -c "cp ..."`
 * before running QDL.exe.
 */

export async function runFlash(channel: vscode.OutputChannel, storage?: 'ufs' | 'emmc'): Promise<void> {
  channel.clear();
  channel.show(true);
  channel.appendLine(`🔥 QuecPi 烧录 (QDL / firehose)${storage ? ` — storage: ${storage.toUpperCase()}` : ''}`);
  channel.appendLine('='.repeat(60));

  // 1. flash package path — use forward slashes for Linux fs access
  const rev = Cfg.projectRev() || 'QSM565DWFPARL1A01_BP01.001_Linux6.6.38_V01';
  const bsp = Cfg.bspPath();
  const pkgLinux = bsp.replace(/\\/g, '/') + '/quectel_build/' + rev;
  const firehoseLinux = pkgLinux + '/prog_firehose_Qcm6490_ddr.elf';
  channel.appendLine('[debug] bspPath=' + bsp);
  channel.appendLine('[debug] isWindows=' + isWindows);
  channel.appendLine('[debug] pkgLinux=' + pkgLinux);

  // On Windows: copy flash package to D: drive (Windows-accessible)
  let pkg = pkgLinux;
  let firehose = firehoseLinux;
  if (isWindows && pkgLinux.indexOf('/mnt/') === 0) {
    const flashDir = 'D:\\quecpi-flash';
    pkg = flashDir;
    firehose = flashDir + '\\prog_firehose_Qcm6490_ddr.elf';
    channel.appendLine('[debug] copying package to D:\\quecpi-flash...');
    try {
      execSync('wsl bash -c "rm -rf /mnt/d/quecpi-flash && mkdir -p /mnt/d/quecpi-flash && cp ' + pkgLinux + '/* /mnt/d/quecpi-flash/"', { timeout: 120000, stdio: 'pipe' });
      channel.appendLine('[debug] copy done');
    } catch (e: any) {
      channel.appendLine('[debug] copy failed: ' + (e.message || e));
    }
  }

  if (!fs.existsSync(firehose)) {
    channel.appendLine('❌ 烧录包未找到: ' + firehose);
    channel.appendLine('   pkgLinux=' + pkgLinux);
    channel.appendLine('   请先运行 buildpackage，或确认 quecpi.build.projectRev 设置。');
    return;
  }
  const raws = fs.readdirSync(pkg).filter((f) => /^rawprogram\d*\.xml$/.test(f)).sort();
  const patches = fs.readdirSync(pkg).filter((f) => /^patch\d*\.xml$/.test(f)).sort();
  channel.appendLine('✅ 烧录包: ' + rev);
  channel.appendLine('   firehose: ' + firehose);
  channel.appendLine('   rawprogram: ' + (raws.join(', ') || '(无)'));
  channel.appendLine('   patch: ' + (patches.join(', ') || '(无)'));

  // 2. find QDL tool
  channel.appendLine('[debug] calling findQdl...');
  const qdl = await findQdl();
  channel.appendLine('[debug] findQdl result=' + qdl);
  if (!qdl) {
    channel.appendLine('❌ 未找到 QDL 烧录工具');
    channel.appendLine('   设置 quecpi.flash.qdlPath 指向 QDL.exe。');
    return;
  }
  channel.appendLine('✅ QDL: ' + qdl);

  // 3. confirm (destructive)
  const confirm = await vscode.window.showWarningMessage(
    '确认向板子烧录？将覆盖全部系统分区！\n工具: ' + qdl + '\n包: ' + rev + '\n存储: ' + (storage || 'auto'),
    { modal: true },
    '开始烧录'
  );
  if (confirm !== '开始烧录') {
    channel.appendLine('已取消。');
    return;
  }

  // 4. enter EDL: adb reboot edl
  const adb = Cfg.adbPath();
  channel.appendLine('\n[1/3] 进入 EDL: ' + adb + ' reboot edl');
  try {
    spawn(adb, ['shell', 'reboot', 'edl'], { detached: true, stdio: 'ignore' }).unref();
    channel.appendLine('   adb reboot edl 已发送（板子将重启进 EDL）');
  } catch {
    channel.appendLine('   ⚠ adb 发送失败，请手动按板子 EMG_DOWNLOAD 按键进 EDL');
  }

  // 5. wait for EDL device (user may need to press reset button)
  channel.appendLine('\n[2/3] 等待 EDL 设备出现（最多 30 秒）...');
  channel.appendLine('   板子进入 EDL 后 USB 设备变为 05c6:9008。');
  channel.appendLine('   如需按 Reset 键，请在 30 秒内操作。');

  let edlFound = false;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const edl = await detectEdl();
    if (edl) {
      channel.appendLine('   ✅ 检测到 EDL: ' + edl + '（第 ' + ((i + 1) * 2) + ' 秒）');
      edlFound = true;
      break;
    }
    if (i % 5 === 4) {
      channel.appendLine('   ... 等待中（' + ((i + 1) * 2) + 's）');
    }
  }
  if (!edlFound) {
    channel.appendLine('   ⚠ 30 秒内未检测到 EDL 设备，QDL 将继续等待...');
  }

  // 6. run QDL
  const sep = isWindows ? '\\' : '/';
  const args = [
    ...(storage ? ['--storage', storage] : []),
    firehose,
    ...raws.map((f) => pkg + sep + f),
    ...patches.map((f) => pkg + sep + f),
  ];
  channel.appendLine('\n[3/3] 烧录: ' + qdl + ' ' + args.join(' ') + '\n');

  const env = isWindows
    ? { ...process.env }
    : { ...process.env, LD_LIBRARY_PATH: `${path.join(path.dirname(qdl), 'lib')}${process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : ''}` };

  await runHost(qdl, args, channel, env);
  channel.appendLine('\n[烧录完成] 若最后显示 SUCCESS / FINISHED 即为成功，可断电重启板子。');
}

/** Detect EDL device (05c6:9008/900e). Platform-aware. */
async function detectEdl(): Promise<string | null> {
  try {
    if (isWindows) {
      const out = execSync(
        'powershell -NoProfile -Command "Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match \'05c6.*9008|05c6.*900e\' } | Select-Object -First 1 -ExpandProperty FriendlyName"',
        { timeout: 5000, encoding: 'utf-8' }
      );
      if (out.trim()) return out.trim();
    } else {
      const devs = fs.readdirSync('/sys/bus/usb/devices');
      for (const d of devs) {
        const base = `/sys/bus/usb/devices/${d}`;
        try {
          const v = fs.readFileSync(`${base}/idVendor`, 'utf8').trim().toLowerCase();
          const p = fs.readFileSync(`${base}/idProduct`, 'utf8').trim().toLowerCase();
          if (v === '05c6' && /^900[8e]$/.test(p)) return `USB 05c6:${p} (${d})`;
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** Find QDL tool. Checks setting, then PATH. */
async function findQdl(): Promise<string | null> {
  const cfg = vscode.workspace.getConfiguration('quecpi.flash').get<string>('qdlPath', '');
  if (cfg && fs.existsSync(cfg)) return cfg;
  try {
    const cmd = isWindows ? 'where' : 'which';
    for (const name of ['qdl', 'QDL.exe', 'qdl.exe']) {
      const r = execSync(`${cmd} ${name}`, { timeout: 5000, encoding: 'utf-8' });
      if (r.trim()) return r.trim().split('\n')[0].trim();
    }
  } catch { /* not found */ }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function runHost(cmd: string, args: string[], channel: vscode.OutputChannel, env?: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { env: env ?? process.env, shell: isWindows });
    const onData = (d: Buffer) => channel.append(d.toString());
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => {
      channel.appendLine(`\n[错误] ${e.message}`);
      resolve(-1);
    });
    proc.on('close', (code) => {
      channel.appendLine(`\n[退出码 ${code}]`);
      resolve(code ?? -1);
    });
  });
}
