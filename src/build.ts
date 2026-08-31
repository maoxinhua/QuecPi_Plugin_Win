import * as vscode from 'vscode';
import { spawn, execFile } from 'child_process';
import { Cfg } from './config';

export interface BuildResult {
  ok: boolean;
  exitCode: number | null;
  durationSec: number;
  output: string;
}

/**
 * Runs a bash snippet in the BSP either directly (local mode) or inside the
 * queecpi-build docker container, streaming stdout/stderr to an OutputChannel.
 */
export async function runBspShell(
  bashSnippet: string,
  channel: vscode.OutputChannel,
  opts: { title?: string; cwd?: string; token?: vscode.CancellationToken } = {}
): Promise<BuildResult> {
  const start = Date.now();
  const bsp = Cfg.bspPath();
  if (!bsp) {
    vscode.window.showErrorMessage('QuecPi: bspPath is not configured and no BSP workspace folder is open.');
    return { ok: false, exitCode: -1, durationSec: 0, output: '' };
  }

  const mode = Cfg.mode();
  let cmd: string;
  let args: string[];
  if (mode === 'docker') {
    cmd = 'docker';
    args = ['exec', '-u', 'builder', '-e', 'SHELL=/bin/bash', Cfg.container(), 'bash', '-lc', `cd /work && ${bashSnippet}`];
  } else {
    cmd = 'bash';
    args = ['-lc', `cd ${JSON.stringify(bsp)} && ${bashSnippet}`];
  }

  channel.appendLine(`\n$ ${cmd} ${args.join(' ')}\n`);
  channel.show(true);

  return new Promise<BuildResult>((resolve) => {
    const proc = spawn(cmd, args, { cwd: opts.cwd ?? bsp });
    // cancellation support (Uniknect-style withProgress + token)
    const cancelSub = opts.token?.onCancellationRequested(() => {
      channel.appendLine('\n[quecpi] cancelled by user — killing process tree...');
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    });
    let output = '';
    const onData = (d: Buffer) => {
      const s = d.toString();
      output += s;
      channel.append(s);
      // bitbake progress like "Running tasks (123 of 456)"
      const m = s.match(/Running tasks \((\d+) of (\d+)\)/g);
      if (m) {
        const last = m[m.length - 1];
        const mm = last.match(/(\d+) of (\d+)/);
        if (mm) {
          vscode.commands.executeCommand('setContext', 'quecpiBuildProgress', `${mm[1]}/${mm[2]}`);
        }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => {
      channel.appendLine(`\n[quecpi] spawn error: ${err.message}`);
      resolve({ ok: false, exitCode: -1, durationSec: (Date.now() - start) / 1000, output });
    });
    proc.on('close', (code) => {
      const dur = (Date.now() - start) / 1000;
      channel.appendLine(`\n[quecpi] finished in ${dur.toFixed(1)}s, exit=${code}`);
      cancelSub?.dispose();
      resolve({ ok: code === 0, exitCode: code, durationSec: dur, output });
    });
  });
}

/** One-shot command returning trimmed stdout (no channel spam). */
export function runQuiet(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) resolve((stdout || '') + (stderr || ''));
      else resolve(stdout || '');
    });
  });
}

const envSetup = `source quectel_build/compile/build.sh >/dev/null 2>&1`;
// NOTE: after sourcing, cwd becomes /work/build-qcom-wayland, so use absolute path.
const threadConf =
  `printf '\\nBB_NUMBER_THREADS = "%d"\\nPARALLEL_MAKE = "-j %d -l %d"\\n' ${Cfg.threads()} ${Cfg.threads()} ${Cfg.threads()} >> /work/build-qcom-wayland/conf/local.conf` +
  ` && printf 'PARALLEL_MAKE:pn-rust-llvm-native = "-j %d"\\nPARALLEL_MAKE:pn-llvm-native = "-j %d"\\nPARALLEL_MAKE:pn-llvm = "-j %d"\\nPARALLEL_MAKE:pn-glslang = "-j %d"\\nPARALLEL_MAKE:pn-spirv-tools = "-j %d"\\n' ${Cfg.llvmJobs()} ${Cfg.llvmJobs()} ${Cfg.llvmJobs()} ${Cfg.llvmJobs()} ${Cfg.llvmJobs()} >> /work/build-qcom-wayland/conf/local.conf`;

export function buildconfigSnippet(): string {
  const rev = Cfg.projectRev() || 'SG565DWFPARL1A02_BL01BP01K0M02V01_QDP_LP6.6.052.01.003V07';
  return `${envSetup} && buildconfig ${Cfg.projectName()} ${rev} ${Cfg.custName()}`;
}

export function buildallSnippet(): string {
  return `${envSetup} && ${threadConf} && buildall`;
}

/**
 * Clean build from scratch: remove tmp (compile intermediates) and optionally
 * sstate-cache, then rebuild the full image. downloads/ is deliberately left
 * intact (source tarballs must never be re-fetched on a slow network).
 */
export function cleanBuildSnippet(includeSstate: boolean): string {
  const clean = includeSstate
    ? 'rm -rf /work/build-qcom-wayland/tmp /work/sstate-cache'
    : 'rm -rf /work/build-qcom-wayland/tmp';
  return `${clean} && ${envSetup} && ${threadConf} && buildall`;
}

export function buildkernelSnippet(): string {
  return `${envSetup} && ${threadConf} && buildkernel`;
}

export function builddtbSnippet(): string {
  return `${envSetup} && ${threadConf} && builddtb`;
}

export function buildpackageSnippet(): string {
  // buildpackage 需要 QUECTEL_PROJECT_* 变量，必须先跑 buildconfig
  return `${buildconfigSnippet()} && buildpackage`;
}

export function rebakeSnippet(recipe: string): string {
  return `${envSetup} && rebake ${recipe}`;
}

/** Exposes progress via status bar. */
export class BuildStatusBar {
  private item: vscode.StatusBarItem;
  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.text = '$(sync~spin) QuecPi build';
    this.item.show();
  }
  setRunning() {
    this.item.text = '$(sync~spin) QuecPi building…';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  setIdle() {
    this.item.text = '$(chip) QuecPi';
    this.item.backgroundColor = undefined;
  }
  dispose() {
    this.item.dispose();
  }
}
