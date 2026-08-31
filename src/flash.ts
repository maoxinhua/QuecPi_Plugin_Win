import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, execFile } from 'child_process';
import { Cfg } from './config';

/**
 * Flash runner: detect the QuecPi H1 board in EDL mode and burn the
 * buildpackage output via a QDL/firehose tool. Runs on the HOST (the board's
 * USB belongs to the host/WSL), not inside the build container.
 */
export async function runFlash(channel: vscode.OutputChannel, storage?: 'ufs' | 'emmc'): Promise<void> {
  channel.clear();
  channel.show(true);
  channel.appendLine(`🔥 QuecPi 烧录 (QDL / firehose)${storage ? ` — storage: ${storage.toUpperCase()}` : ''}`);
  channel.appendLine('='.repeat(60));

  // 1. flash package (from buildpackage)
  const rev = Cfg.projectRev() || 'SG565DWFPARL1A02_BL01BP01K0M02V01_QDP_LP6.6.052.01.003V07';
  const pkg = path.join(Cfg.bspPath(), 'quectel_build', rev);
  const firehose = path.join(pkg, 'prog_firehose_Qcm6490_ddr.elf');
  if (!fs.existsSync(firehose)) {
    channel.appendLine(`❌ 烧录包未找到: ${pkg}`);
    channel.appendLine('   请先在控制面板点「📦 制作烧录包 (buildpackage)」，或确认 quecpi.flash.packageDir。');
    return;
  }
  const raws = fs.readdirSync(pkg).filter((f) => /^rawprogram\d*\.xml$/.test(f)).sort();
  const patches = fs.readdirSync(pkg).filter((f) => /^patch\d*\.xml$/.test(f)).sort();
  channel.appendLine(`✅ 烧录包: ${rev} (${pkg})`);
  channel.appendLine(`   firehose: ${path.basename(firehose)}`);
  channel.appendLine(`   rawprogram: ${raws.join(', ') || '(无)'}`);
  channel.appendLine(`   patch: ${patches.join(', ') || '(无)'}`);

  // 2. detect EDL device
  const edl = await detectEdl();
  if (edl) {
    channel.appendLine(`✅ 检测到 EDL 设备: ${edl}`);
  } else {
    channel.appendLine('⚠ 未检测到 EDL 设备 (Qualcomm 05c6:9008/900e)');
    channel.appendLine('   请把板子用 USB 连到本机并进入 EDL（强制下载）模式后重试。');
    channel.appendLine('   常见进法：按住音量上键上电，或执行 "adb reboot edl"。');
  }

  // 3. find qdl tool
  const qdl = await findQdl();
  if (qdl) {
    channel.appendLine(`✅ QDL 工具: ${qdl}`);
  } else {
    channel.appendLine('❌ 未找到 QDL 烧录工具');
    channel.appendLine('   方案一 (Windows)：用高通 QPM / qfiledownloader，选择下面目录作烧录目录：');
    channel.appendLine(`     ${pkg}`);
    channel.appendLine('   方案二 (Linux)：安装 linaro qdl 后设置 quecpi.flash.qdlPath：');
    channel.appendLine('     curl -L -o ~/qdl https://github.com/linux-msm/qdl/releases/latest/download/qdl');
    channel.appendLine('     chmod +x ~/qdl   →  设置 quecpi.flash.qdlPath = /home/你的用户名/qdl');
    return;
  }

  if (!edl) {
    channel.appendLine('\n板子未进 EDL，暂停烧录。设备就绪后重新运行「烧录到板」。');
    return;
  }

  // 4. confirm (destructive)
  const confirm = await vscode.window.showWarningMessage(
    `确认向板子烧录？将覆盖全部系统分区！\n工具: ${qdl}\n包: ${rev}`,
    { modal: true },
    '开始烧录'
  );
  if (confirm !== '开始烧录') {
    channel.appendLine('已取消。');
    return;
  }

  // 5. run qdl
  const args = [
    ...(storage ? ['--storage', storage] : []),
    '-f', firehose,
    ...raws.map((f) => path.join(pkg, f)),
    ...patches.map((f) => path.join(pkg, f)),
  ];
  channel.appendLine(`\n$ ${qdl} ${args.join(' ')}\n`);
  // qdl needs libusb; a local copy may sit next to it in <qdl dir>/lib
  const qdlDir = path.dirname(qdl);
  const env = {
    ...process.env,
    LD_LIBRARY_PATH: `${path.join(qdlDir, 'lib')}${process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : ''}`,
  };
  await runHost(qdl, args, channel, env);
  channel.appendLine('\n[烧录完成] 若最后显示 SUCCESS / FINISHED 即为成功，可断电重启板子。');
}

async function detectEdl(): Promise<string | null> {
  try {
    const devs = fs.readdirSync('/sys/bus/usb/devices');
    for (const d of devs) {
      const base = `/sys/bus/usb/devices/${d}`;
      try {
        const v = fs.readFileSync(`${base}/idVendor`, 'utf8').trim().toLowerCase();
        const p = fs.readFileSync(`${base}/idProduct`, 'utf8').trim().toLowerCase();
        if (v === '05c6' && /^900[8e]$/.test(p)) {
          return `USB 05c6:${p} (${d})`;
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const ttys = fs.readdirSync('/dev').filter((f) => /^tty(USB|ACM)/.test(f));
    if (ttys.length) return `串口 /dev/${ttys.join(', /dev/')}`;
  } catch {
    /* ignore */
  }
  return null;
}

async function findQdl(): Promise<string | null> {
  const cfg = vscode.workspace.getConfiguration('quecpi.flash').get<string>('qdlPath', '');
  if (cfg && fs.existsSync(cfg)) return cfg;
  for (const cmd of ['qdl', 'qdl.py', 'qfiledownloader']) {
    const r = await runQuiet('which', [cmd]);
    if (r.trim()) return r.trim();
  }
  return null;
}

function runQuiet(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) => {
      resolve((stdout || '') + (stderr || ''));
    });
  });
}

function runHost(cmd: string, args: string[], channel: vscode.OutputChannel, env?: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { env: env ?? process.env });
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
