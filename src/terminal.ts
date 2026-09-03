import * as vscode from 'vscode';
import { execFileSync } from 'child_process';
import * as os from 'os';
import { Cfg, isWindows } from './config';

/**
 * Shared utilities:
 *  - getSharedTerminal: reuse a live terminal by name
 *  - ensureTool: check a CLI exists (platform-aware)
 *  - wslToWinPath: map a WSL/Linux path to a Windows-accessible path
 */

/** Reuse a terminal by name if alive, else create one.
 *  On Windows, explicitly set cwd to the user home dir — otherwise VS Code
 *  defaults to the workspace root (a WSL UNC path it converts to an invalid
 *  Linux-style /mnt/wsl/... that Windows terminals can't open). */
export function getSharedTerminal(name: string): vscode.Terminal {
  const existing = vscode.window.terminals.find((t) => t.name === name && t.exitStatus === undefined);
  if (existing) return existing;
  const cwd = isWindows ? os.homedir() : Cfg.bspPath() || undefined;
  return vscode.window.createTerminal({ name, cwd });
}

/**
 * Ensure a CLI tool exists. On Windows uses `where`, on Linux uses `which`.
 */
export async function ensureTool(tool: string, label: string, installCmd?: string): Promise<boolean> {
  try {
    if (isWindows) {
      execFileSync('where', [tool], { stdio: 'ignore', shell: true });
    } else {
      execFileSync('which', [tool], { stdio: 'ignore' });
    }
    return true;
  } catch { /* not found */ }
  if (installCmd) {
    const go = await vscode.window.showWarningMessage(
      `"${label}" (${tool}) not found. Install it?`,
      'Install', 'Cancel'
    );
    if (go === 'Install') {
      const term = getSharedTerminal('QuecPi Install');
      term.show();
      term.sendText(installCmd);
    }
  } else {
    void vscode.window.showWarningMessage(`"${label}" (${tool}) not found.`);
  }
  return false;
}

/**
 * Map a WSL/Linux path to a Windows-accessible path.
 * /mnt/c/Foo → C:\Foo; other /path → \\wsl.localhost\<distro>\path
 */
export function wslToWinPath(linuxPath: string): string {
  if (!isWindows || !linuxPath) return linuxPath;
  const m = linuxPath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (m) return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
  const distro = process.env.WSL_DISTRO_NAME || 'Ubuntu-24.04';
  return `\\\\wsl.localhost\\${distro}\\${linuxPath.replace(/^\//, '').replace(/\//g, '\\')}`;
}
