import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { Cfg, isWindows } from './config';
import { getSharedTerminal, ensureTool } from './terminal';
import { runFlash } from './flash';

/**
 * Host-side device debug commands (adb-based). The board connects via USB to
 * the HOST (not the build container). Refactored with shared-terminal reuse
 * and host-tool checks (borrowed from the Uniknect pattern).
 */

/** Run `adb shell <cmd>` on host, stream output to the channel. */
export async function adbCmd(channel: vscode.OutputChannel, subCmd: string): Promise<void> {
  if (!(await ensureTool(Cfg.adbPath(), 'adb', 'sudo apt-get install -y adb'))) return;
  channel.show(true);
  channel.appendLine(`\n$ adb shell ${subCmd}\n`);
  return new Promise((resolve) => {
    const proc = spawn(Cfg.adbPath(), ['shell', ...subCmd.split(' ')], { cwd: Cfg.bspPath() || undefined });
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

/** Open an interactive `adb shell` in a shared terminal. */
export async function adbShell(): Promise<void> {
  if (!(await ensureTool(Cfg.adbPath(), 'adb', 'sudo apt-get install -y adb'))) return;
  const term = getSharedTerminal('QuecPi ADB');
  term.show();
  term.sendText(`${Cfg.adbPath()} shell`);
}

/** Open a shared terminal running `adb shell <cmd>` (follow/interactive). */
export async function adbTerm(cmd: string): Promise<void> {
  if (!(await ensureTool(Cfg.adbPath(), 'adb', 'sudo apt-get install -y adb'))) return;
  const term = getSharedTerminal('QuecPi ADB');
  term.show();
  term.sendText(`${Cfg.adbPath()} shell ${cmd}`);
}

/** Reboot the device (or into EDL). */
export async function rebootDevice(edl = false): Promise<void> {
  if (!(await ensureTool(Cfg.adbPath(), 'adb', 'sudo apt-get install -y adb'))) return;
  const action = edl ? 'reboot into EDL mode' : 'reboot device';
  const confirm = await vscode.window.showWarningMessage(`Confirm ${action}?`, { modal: true }, 'Confirm');
  if (confirm !== 'Confirm') return;
  const cmd = edl ? 'reboot edl' : 'reboot';
  const term = getSharedTerminal('QuecPi ADB');
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
  const term = getSharedTerminal('QuecPi AT');
  term.show();
  term.sendText(`echo -n '${cmd}\r' > ${port} && timeout 2 cat ${port}`);
}

/** Screenshot: adb screencap + pull + open. */
export async function screenshot(channel: vscode.OutputChannel): Promise<void> {
  if (!(await ensureTool(Cfg.adbPath(), 'adb', 'sudo apt-get install -y adb'))) return;
  channel.show(true);
  channel.appendLine('\n[screenshot] adb screencap -> pull -> open\n');
  const localPath = `/tmp/quecpi-screen-$(date +%s).png`;
  const proc = spawn('bash', ['-lc',
    `${Cfg.adbPath()} shell screencap -p /sdcard/screen.png && ${Cfg.adbPath()} pull /sdcard/screen.png ${localPath} && echo "PULLED:${localPath}"`],
    { cwd: Cfg.bspPath() || undefined });
  const onData = (d: Buffer) => channel.append(d.toString());
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('close', async (code) => {
    if (code === 0) {
      const uri = vscode.Uri.file(localPath.replace('PULLED:', ''));
      await vscode.commands.executeCommand('vscode.open', uri);
    }
    channel.appendLine(`\n[exit ${code}]`);
  });
}

/** Flash via the official QDL path (qdl + firehose + rawprogram/patch). */
export async function flashStorage(channel: vscode.OutputChannel, storage: 'ufs' | 'emmc'): Promise<void> {
  return runFlash(channel, storage);
}
