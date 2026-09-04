import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, execFile } from 'child_process';
import { Cfg, isWindows } from './config';

/**
 * Flash runner: one-click EDL flash — adb reboot edl → wait → QDL burn.
 *
 * Verified flow (manual test passed):
 *   adb shell reboot edl → board enters EDL (05c6:9008) → QDL.exe --storage ufs ...
 *
 * Key fixes vs previous version:
 *   1. detectEdl uses async execFile (not execSync) — doesn't block event loop
 *   2. Flash lock prevents duplicate clicks
 *   3. Confirm dialog BEFORE copy (fast feedback)
 *   4. runHost sets cwd to flash package dir
 */

let flashing = false; // lock to prevent duplicate clicks

export async function runFlash(channel: vscode.OutputChannel, storage?: 'ufs' | 'emmc'): Promise<void> {
  if (flashing) {
    channel.show(true);
    channel.appendLine('\n⚠ 烧录正在进行中，请等待完成。');
    return;
  }
  flashing = true;
  try {
    await doFlash(channel, storage);
  } catch (e: any) {
    channel.appendLine('\n[错误] ' + (e?.message || e));
  } finally {
    flashing = false;
  }
}

async function doFlash(channel: vscode.OutputChannel, storage?: 'ufs' | 'emmc'): Promise<void> {
  channel.clear();
  channel.show(true);
  channel.appendLine(`🔥 QuecPi 烧录 (QDL / firehose)${storage ? ` — storage: ${storage.toUpperCase()}` : ''}`);
  channel.appendLine('='.repeat(60));

  // 1. find flash package
  const rev = Cfg.projectRev() || 'QSM565DWFPARL1A01_BP01.001_Linux6.6.38_V01';
  const bsp = Cfg.bspPath();
  const pkgLinux = bsp.replace(/\\/g, '/') + '/quectel_build/' + rev;
  const firehoseLinux = pkgLinux + '/prog_firehose_Qcm6490_ddr.elf';
  channel.appendLine('[debug] bspPath=' + bsp);
  channel.appendLine('[debug] isWindows=' + isWindows);
  channel.appendLine('[debug] pkgLinux=' + pkgLinux);

  // 2. find QDL tool (before confirming — fast feedback)
  const qdl = await findQdl();
  if (!qdl) {
    channel.appendLine('❌ 未找到 QDL 烧录工具');
    channel.appendLine('   设置 quecpi.flash.qdlPath 指向 QDL.exe。');
    return;
  }
  channel.appendLine('✅ QDL: ' + qdl);

  // 3. confirm (destructive) — BEFORE copy so user gets instant feedback
  const confirm = await vscode.window.showWarningMessage(
    '确认向板子烧录？将覆盖全部系统分区！\n工具: ' + qdl + '\n包: ' + rev + '\n存储: ' + (storage || 'auto'),
    { modal: true },
    '开始烧录'
  );
  if (confirm !== '开始烧录') {
    channel.appendLine('已取消。');
    return;
  }

  // 4. copy flash package to D: drive (Windows-accessible)
  let pkg = pkgLinux;
  let firehose = firehoseLinux;
  if (isWindows && pkgLinux.indexOf('/mnt/') === 0) {
    const flashDir = 'D:\\quecpi-flash';
    pkg = flashDir;
    firehose = flashDir + '\\prog_firehose_Qcm6490_ddr.elf';

    // Skip copy if local files exist AND source is not newer (compare timestamps)
    if (fs.existsSync(firehose) && fs.existsSync(flashDir + '\\rawprogram0.xml')) {
      // Get source modification time (WSL stat, epoch seconds)
      let srcMtime = 0;
      try {
        const out = await execAsyncOutput('wsl', ['bash', '-c', 'stat -c %Y ' + firehoseLinux], 5000);
        srcMtime = parseInt(out.trim()) || 0;
      } catch { /* ignore */ }
      // Get local modification time (epoch ms → seconds)
      const localMtime = Math.floor(fs.statSync(firehose).mtimeMs / 1000);
      if (srcMtime > 0 && srcMtime <= localMtime) {
        // Source is same age or older → local copy is up-to-date, skip copy
        channel.appendLine('✅ 烧录包已是最新（跳过复制，上次更新: ' + new Date(localMtime * 1000).toLocaleString() + '）');
      } else {
        // Source is newer (new buildpackage) → re-copy
        channel.appendLine('[debug] 镜像已更新，重新复制...');
        await copyPackage(pkgLinux, channel);
      }
    } else {
      // First time → copy
      channel.appendLine('[debug] 首次复制烧录包到 D:\\quecpi-flash...');
      await copyPackage(pkgLinux, channel);
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

  // 5. enter EDL: adb reboot edl (fire and forget)
  const adb = Cfg.adbPath();
  channel.appendLine('\n[1/3] 进入 EDL: ' + adb + ' shell reboot edl');
  channel.appendLine('   如果板子已在 EDL 模式（9008 端口已出现），可跳过此步。');
  try {
    spawn(adb, ['shell', 'reboot', 'edl'], { detached: true, stdio: 'ignore' }).unref();
    channel.appendLine('   adb reboot edl 已发送（板子将重启进 EDL，adb 连接会断开，这是正常的）');
  } catch {
    channel.appendLine('   ⚠ adb 发送失败（板子可能已进 EDL），继续等待 9008 设备...');
  }

  // 6. wait for EDL device (async polling — does NOT block event loop)
  channel.appendLine('\n[2/3] 等待 EDL 设备出现（最多 60 秒）...');
  channel.appendLine('   板子进入 EDL 后 USB 设备变为 05c6:9008。');
  channel.appendLine('   如需手动按 EMG_DOWNLOAD 按键，请在 60 秒内操作。');

  let edlFound = false;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const edl = await detectEdlAsync();
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
    channel.appendLine('   ⚠ 60 秒内未检测到 EDL 设备，QDL 将继续等待...');
  }

  // 7. run QDL (with cwd = flash package dir)
  const sep = isWindows ? '\\' : '/';
  const args = [
    ...(storage ? ['--storage', storage] : []),
    firehose,
    ...raws.map((f) => pkg + sep + f),
    ...patches.map((f) => pkg + sep + f),
  ];
  channel.appendLine('\n[3/3] 烧录: ' + qdl + ' ' + args.join(' '));
  channel.appendLine('   工作目录: ' + pkg);
  channel.appendLine('   烧录中...（请勿关闭 VS Code 或断开 USB）\n');

  const env = isWindows
    ? { ...process.env }
    : { ...process.env, LD_LIBRARY_PATH: `${path.join(path.dirname(qdl), 'lib')}${process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : ''}` };

  await runHost(qdl, args, channel, env, pkg);
  channel.appendLine('\n[烧录完成] 若最后显示 "partition 1 is now bootable" 即为成功，板子将自动重启。');
}

/** Async detect EDL device — uses execFile (non-blocking), NOT execSync.
 *  Returns device name + InstanceId for verification. */
function detectEdlAsync(): Promise<string | null> {
  return new Promise((resolve) => {
    if (isWindows) {
      execFile('powershell', ['-NoProfile', '-Command',
        "Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '05c6.*9008|05c6.*900e' } | Select-Object -First 1 FriendlyName,InstanceId | Format-List"],
        { timeout: 5000, encoding: 'utf-8' },
        (err, stdout) => {
          if (err) { resolve(null); return; }
          const out = stdout.trim();
          if (out) {
            // Parse FriendlyName + InstanceId
            const name = (out.match(/FriendlyName\s*:\s*(.+)/) || [])[1]?.trim() || out;
            const id = (out.match(/InstanceId\s*:\s*(.+)/) || [])[1]?.trim() || '';
            resolve(name + (id ? ' [' + id + ']' : ''));
          } else {
            resolve(null);
          }
        }
      );
    } else {
      try {
        const devs = fs.readdirSync('/sys/bus/usb/devices');
        for (const d of devs) {
          const base = `/sys/bus/usb/devices/${d}`;
          try {
            const v = fs.readFileSync(`${base}/idVendor`, 'utf8').trim().toLowerCase();
            const p = fs.readFileSync(`${base}/idProduct`, 'utf8').trim().toLowerCase();
            if (v === '05c6' && /^900[8e]$/.test(p)) { resolve(`USB 05c6:${p} (${d})`); return; }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      resolve(null);
    }
  });
}

/** Find QDL tool. Checks setting, then PATH. */
async function findQdl(): Promise<string | null> {
  const cfg = vscode.workspace.getConfiguration('quecpi.flash').get<string>('qdlPath', '');
  if (cfg && fs.existsSync(cfg)) return cfg;
  // Try PATH lookup (async)
  return new Promise((resolve) => {
    const cmd = isWindows ? 'where' : 'which';
    execFile(cmd, ['qdl'], { timeout: 5000, encoding: 'utf-8' }, (err, stdout) => {
      if (err) {
        if (isWindows) {
          execFile('where', ['QDL.exe'], { timeout: 5000, encoding: 'utf-8' }, (e2, s2) => {
            resolve(!e2 && s2.trim() ? s2.trim().split('\n')[0].trim() : null);
          });
        } else {
          resolve(null);
        }
      } else {
        resolve(stdout.trim() || null);
      }
    });
  });
}

/** Async exec — non-blocking wrapper. */
function execAsync(cmd: string, args: string[], timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'ignore', timeout });
    proc.on('close', (code) => { if (code === 0) resolve(); else reject(new Error(`exit ${code}`)); });
    proc.on('error', reject);
  });
}

/** Async exec with stdout capture. */
function execAsyncOutput(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, encoding: 'utf-8' }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout || '');
    });
  });
}

/** Copy flash package from WSL to D: drive (non-blocking). */
async function copyPackage(pkgLinux: string, channel: vscode.OutputChannel): Promise<void> {
  try {
    await execAsync('wsl', ['bash', '-c', 'rm -rf /mnt/d/quecpi-flash && mkdir -p /mnt/d/quecpi-flash && cp -r ' + pkgLinux + '/* /mnt/d/quecpi-flash/'], 300000);
    channel.appendLine('[debug] copy done');
  } catch (e: any) {
    channel.appendLine('[debug] copy failed: ' + (e?.message || e));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function runHost(cmd: string, args: string[], channel: vscode.OutputChannel, env?: NodeJS.ProcessEnv, cwd?: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { env: env ?? process.env, shell: isWindows, cwd });
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
