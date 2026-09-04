import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { Cfg, isWindows } from './config';
import { runFlash } from './flash';

/**
 * Host-side device debug commands (adb-based). The board connects via USB to
 * the HOST. Platform-aware: Windows uses adb.exe directly, WSL uses bash.
 *
 * No ensureTool checks — adb path comes from settings (quecpi.adb.path).
 */

/** Run `adb shell <cmd>` on host, stream output to the channel. */
export async function adbCmd(channel: vscode.OutputChannel, subCmd: string): Promise<void> {
  channel.show(true);
  channel.appendLine(`\n$ adb shell ${subCmd}\n`);
  return new Promise((resolve) => {
    const proc = spawn(Cfg.adbPath(), ['shell', ...subCmd.split(' ')]);
    const onData = (d: Buffer) => channel.append(d.toString());
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => {
      channel.appendLine(`\n[error] ${e.message}`);
      resolve();
    });
    proc.on('close', (code) => {
      channel.appendLine(`\n[exit ${code}]`);
      resolve();
    });
  });
}

/** Open an interactive `adb shell` in a fresh terminal. */
export async function adbShell(): Promise<void> {
  const term = vscode.window.createTerminal({ name: 'QuecPi ADB' });
  term.show();
  term.sendText(`${Cfg.adbPath()} shell`);
}

/** Open a terminal running `adb shell <cmd>` (follow/interactive). */
export async function adbTerm(cmd: string): Promise<void> {
  const term = vscode.window.createTerminal({ name: 'QuecPi ADB' });
  term.show();
  term.sendText(`${Cfg.adbPath()} shell ${cmd}`);
}

/** Reboot the device (or into EDL). */
export async function rebootDevice(edl = false): Promise<void> {
  const action = edl ? 'reboot into EDL mode' : 'reboot device';
  const confirm = await vscode.window.showWarningMessage(`Confirm ${action}?`, { modal: true }, 'Confirm');
  if (confirm !== 'Confirm') return;
  const cmd = edl ? 'reboot edl' : 'reboot';
  const term = vscode.window.createTerminal({ name: 'QuecPi ADB' });
  term.show();
  term.sendText(`${Cfg.adbPath()} shell ${cmd}`);
}

/** Send an AT command via serial port (input dialog, optional pre-fill). */
export async function atSend(channel: vscode.OutputChannel, preFill?: string): Promise<void> {
  const cmd = await vscode.window.showInputBox({
    prompt: 'Enter AT command (e.g. AT+QMAC?)',
    placeHolder: 'AT+QGMR',
    ...(preFill ? { value: preFill } : {}),
  });
  if (!cmd) return;
  const port = Cfg.serialPort();
  channel.show(true);
  channel.appendLine(`\n[AT send] ${cmd} -> ${port}\n`);
  if (isWindows) {
    const term = vscode.window.createTerminal({ name: 'QuecPi AT' });
    term.show();
    const ps = `$p = New-Object System.IO.Ports.SerialPort("${port}", 115200); $p.Open(); $p.WriteLine('${cmd}\\r'); Start-Sleep -Seconds 2; $p.Close()`;
    term.sendText(`powershell -NoProfile -Command '${ps}'`);
  } else {
    const term = vscode.window.createTerminal({ name: 'QuecPi AT' });
    term.show();
    term.sendText(`echo -n '${cmd}\r' > ${port} && timeout 2 cat ${port}`);
  }
}

/** Screenshot: adb screencap + pull + open. */
export async function screenshot(channel: vscode.OutputChannel): Promise<void> {
  channel.show(true);
  channel.appendLine('\n[screenshot] adb screencap -> pull -> open\n');
  const tmpDir = isWindows ? os.tmpdir() : '/tmp';
  const localPath = path.join(tmpDir, `quecpi-screen-${Date.now()}.png`);
  if (isWindows) {
    const proc = spawn(Cfg.adbPath(), ['shell', 'screencap', '-p', '/sdcard/screen.png']);
    proc.stdout.on('data', (d: Buffer) => channel.append(d.toString()));
    proc.stderr.on('data', (d: Buffer) => channel.append(d.toString()));
    proc.on('close', async (code) => {
      if (code === 0) {
        const pull = spawn(Cfg.adbPath(), ['pull', '/sdcard/screen.png', localPath]);
        pull.stdout.on('data', (d: Buffer) => channel.append(d.toString()));
        pull.stderr.on('data', (d: Buffer) => channel.append(d.toString()));
        pull.on('close', async () => {
          const uri = vscode.Uri.file(localPath);
          await vscode.commands.executeCommand('vscode.open', uri);
          channel.appendLine(`\n[saved: ${localPath}]`);
        });
      } else {
        channel.appendLine(`\n[exit ${code}]`);
      }
    });
  } else {
    const proc = spawn('bash', ['-lc',
      `${Cfg.adbPath()} shell screencap -p /sdcard/screen.png && ${Cfg.adbPath()} pull /sdcard/screen.png ${localPath}`]);
    const onData = (d: Buffer) => channel.append(d.toString());
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('close', async (code) => {
      if (code === 0) {
        const uri = vscode.Uri.file(localPath);
        await vscode.commands.executeCommand('vscode.open', uri);
      }
      channel.appendLine(`\n[exit ${code}]`);
    });
  }
}

/** Flash via the official QDL path (qdl + firehose + rawprogram/patch). */
export async function flashStorage(channel: vscode.OutputChannel, storage: 'ufs' | 'emmc'): Promise<void> {
  return runFlash(channel, storage);
}
