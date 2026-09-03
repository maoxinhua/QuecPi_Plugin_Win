import * as vscode from 'vscode';
import { runQuiet } from './build';
import { Cfg } from './config';

/**
 * Shared utilities borrowed from the Uniknect pattern:
 *  - getSharedTerminal: reuse a live terminal by name instead of spawning new ones
 *  - ensureTool: check a host CLI exists, offer one-click install guidance
 */

/** Reuse a terminal by name if it is still alive, else create one. */
export function getSharedTerminal(name: string): vscode.Terminal {
  const existing = vscode.window.terminals.find((t) => t.name === name && t.exitStatus === undefined);
  return existing || vscode.window.createTerminal({ name, cwd: Cfg.bspPath() || undefined });
}

/**
 * Ensure a CLI tool exists on the host. Returns true if available; otherwise
 * shows guidance and (when installCmd is given) offers one-click install.
 */
export async function ensureTool(tool: string, label: string, installCmd?: string): Promise<boolean> {
  const which = await runQuiet('bash', ['-lc', `command -v ${tool}`]);
  if (which.trim()) return true;
  if (installCmd) {
    const go = await vscode.window.showWarningMessage(
      `"${label}" (${tool}) not found on the host. Install it?`,
      'Install',
      'Cancel'
    );
    if (go === 'Install') {
      const term = getSharedTerminal('QuecPi Install');
      term.show();
      term.sendText(installCmd);
    }
  } else {
    vscode.window.showWarningMessage(`"${label}" (${tool}) not found on the host.`);
  }
  return false;
}
