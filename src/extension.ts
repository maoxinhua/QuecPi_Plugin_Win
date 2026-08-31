import * as vscode from 'vscode';
import * as path from 'path';
import { Cfg, isWindows } from './config';
import {
  runBspShell,
  buildconfigSnippet,
  buildallSnippet,
  buildkernelSnippet,
  builddtbSnippet,
  buildpackageSnippet,
  rebakeSnippet,
  cleanBuildSnippet,
  BuildStatusBar,
} from './build';
import { ArtifactsProvider, BuildTasksProvider, pickBitbakeLog } from './artifacts';
import { openSerialMonitor, showFlashHelp } from './serial';
import { runFlash } from './flash';
import { adbCmd, adbShell, adbTerm, rebootDevice, atSend, screenshot, flashStorage } from './device';
import { ChatPanel } from './chat/ChatPanel';
import { ControlPanel } from './panel/ControlPanel';
import { SidebarProvider } from './panel/SidebarProvider';
import { listAgentPresets, copyAgentPreset } from './chat/harness';

export function activate(context: vscode.ExtensionContext) {
  const channel = vscode.window.createOutputChannel('QuecPi Build');
  const statusBar = new BuildStatusBar();
  const artifacts = new ArtifactsProvider();
  const tasks = new BuildTasksProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('quecpiArtifacts', artifacts),
    vscode.window.registerTreeDataProvider('quecpiBuildTasks', tasks),
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, new SidebarProvider(context.extensionUri)),
    vscode.commands.registerCommand('quecpi.panel', () => ControlPanel.create(context.extensionUri)),
    vscode.commands.registerCommand('quecpi.panelPopout', () => ControlPanel.popout(context.extensionUri)),
    vscode.commands.registerCommand('quecpi.copilot', async () => {
      const ext = vscode.extensions.getExtension('GitHub.copilot-chat');
      if (!ext) {
        const go = await vscode.window.showWarningMessage('GitHub Copilot Chat is not installed. Install it?', 'Install', 'Cancel');
        if (go === 'Install') await vscode.commands.executeCommand('workbench.extensions.installExtension', 'GitHub.copilot-chat');
        return;
      }
      await vscode.commands.executeCommand('workbench.action.chat.toggle');
    }),
    vscode.commands.registerCommand('quecpi.openArtifact', (fp: string) => openArtifact(fp)),
    vscode.commands.registerCommand('quecpi.buildconfig', () =>
      winGuard(runWithStatus(statusBar, () => runBspShell(buildconfigSnippet(), channel, { title: 'buildconfig' })), 'Configure')
    ),
    vscode.commands.registerCommand('quecpi.buildall', () =>
      winGuard(runWithStatus(statusBar, async () => {
        // progress notification + cancellable (Uniknect-style withProgress)
        const r = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'QuecPi Build All', cancellable: true },
          async (progress, token) => {
            progress.report({ message: 'bitbake qcom-multimedia-image...' });
            const r2 = await runBspShell(buildallSnippet(), channel, { title: 'buildall', token });
            progress.report({ message: r2.ok ? 'done' : `failed (exit ${r2.exitCode})`, increment: 100 });
            return r2;
          });
        artifacts.refresh();
        return r;
      }), 'Build All')
    ),
    vscode.commands.registerCommand('quecpi.buildClean', () => winGuard(cleanBuild(statusBar, channel), 'Clean Build')),
    vscode.commands.registerCommand('quecpi.buildkernel', () =>
      winGuard(runWithStatus(statusBar, () => runBspShell(buildkernelSnippet(), channel, { title: 'buildkernel' })), 'Kernel')
    ),
    vscode.commands.registerCommand('quecpi.builddtb', () =>
      winGuard(runWithStatus(statusBar, () => runBspShell(builddtbSnippet(), channel, { title: 'builddtb' })), 'DTB')
    ),
    vscode.commands.registerCommand('quecpi.buildpackage', () =>
      winGuard(runWithStatus(statusBar, () => runBspShell(buildpackageSnippet(), channel, { title: 'buildpackage' })), 'Package')
    ),
    vscode.commands.registerCommand('quecpi.rebake', async () => {
      const recipe = await vscode.window.showInputBox({ prompt: 'Recipe to rebake (e.g. virtual/kernel, linux-qcom-custom)', placeHolder: 'virtual/kernel' });
      if (!recipe) return;
      await guard(runWithStatus(statusBar, () => runBspShell(rebakeSnippet(recipe), channel, { title: `rebake ${recipe}` })));
    }),
    vscode.commands.registerCommand('quecpi.openBuildDir', () => {
      const dir = Cfg.deployDir();
      vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(dir)).then(undefined, () => {
        vscode.window.showInformationMessage(`Deploy dir: ${dir}`);
      });
    }),
    vscode.commands.registerCommand('quecpi.openBitbakeLog', async () => {
      const log = await pickBitbakeLog();
      if (log) await vscode.window.showTextDocument(vscode.Uri.file(log));
    }),
    vscode.commands.registerCommand('quecpi.serialMonitor', openSerialMonitor),
    vscode.commands.registerCommand('quecpi.flashHelp', showFlashHelp),
    vscode.commands.registerCommand('quecpi.newPreset', async () => {
      // 更新/创建 Agent 预设：复制一个既有预设
      try {
        const presets = await listAgentPresets(Cfg.harnessUrl());
        const from = await vscode.window.showQuickPick(
          presets.map((p) => ({ label: p.name ?? p.id, detail: p.id, description: p.trust })),
          { placeHolder: 'Copy which preset as the base?' }
        );
        if (!from) return;
        const id = await vscode.window.showInputBox({ prompt: 'New preset id (directory name, [a-z0-9-])', placeHolder: 'my-preset' });
        if (!id) return;
        await copyAgentPreset(Cfg.harnessUrl(), from.detail, id);
        vscode.window.showInformationMessage(`Preset "${id}" created (copied from ${from.detail}). Edit its files in ~/.dsh/.agent-presets/${id}/`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Create preset failed: ${e?.message ?? e}`);
      }
    }),
    vscode.commands.registerCommand('quecpi.flash', () =>
      guard(runWithStatus(statusBar, () => runFlash(channel)))
    ),
    // ── 设备调试命令（host-side adb） ──
    vscode.commands.registerCommand('quecpi.adbCmd', (args?: string) =>
      adbCmd(channel, args || 'devices')
    ),
    vscode.commands.registerCommand('quecpi.adbShell', () => adbShell()),
    vscode.commands.registerCommand('quecpi.adbTerm', (args?: string) =>
      adbTerm(args || 'shell')
    ),
    vscode.commands.registerCommand('quecpi.reboot', () => rebootDevice(false)),
    vscode.commands.registerCommand('quecpi.rebootEdl', () => rebootDevice(true)),
    vscode.commands.registerCommand('quecpi.atSend', (args?: string) => atSend(channel, args)),
    vscode.commands.registerCommand('quecpi.screenshot', () => screenshot(channel)),
    vscode.commands.registerCommand('quecpi.flashUfs', () => flashStorage(channel, 'ufs')),
    vscode.commands.registerCommand('quecpi.flashEmmc', () => flashStorage(channel, 'emmc')),
    vscode.commands.registerCommand('quecpi.chat', () => ChatPanel.create(context.extensionUri)),
    statusBar
  );
}

/** Windows 版不支持固件构建（docker 不可用）——拦截 build 类命令。 */
function winGuard(p: Promise<any>, what: string): Promise<any> {
  if (isWindows) {
    vscode.window.showWarningMessage(`Windows 版不支持「${what}」——固件构建请在 WSL/Linux 环境进行（本版保留调试/烧录/日志功能）。`);
    return Promise.resolve();
  }
  return p;
}

/** Early-return wrapper so a failing BSP path shows a message instead of an unhandled error. */
function guard(p: Promise<any>): Promise<any> {
  return p.catch((err) => {
    vscode.window.showErrorMessage(`QuecPi: ${err?.message ?? err}`);
    return undefined;
  });
}

async function runWithStatus(statusBar: BuildStatusBar, fn: () => Promise<any>) {
  statusBar.setRunning();
  try {
    return await fn();
  } finally {
    statusBar.setIdle();
  }
}

/** Clean Build: pick scope, confirm (destructive), then wipe + full rebuild. */
async function cleanBuild(statusBar: BuildStatusBar, channel: vscode.OutputChannel) {
  const scope = await vscode.window.showQuickPick(
    [
      {
        label: '$(trash) 删编译中间物 (tmp) — 保留 sstate 缓存',
        description: '删除 tmp 后重建，复用 sstate 缓存（较快）',
        value: false,
      },
      {
        label: '$(trash) 完全从头 (tmp + sstate) — 全部重编',
        description: '最彻底，全部从源码重编（约 20+ 小时）',
        value: true,
      },
    ],
    { placeHolder: '选择 Clean Build 的清理范围（破坏性，不可撤销）' }
  );
  if (!scope) return;

  const what = scope.value ? 'tmp + sstate-cache' : 'tmp（编译中间物）';
  const confirm = await vscode.window.showWarningMessage(
    `确认删除 ${what} 并从头完整构建 qcom-multimedia-image？\n\n(downloads/ 源码缓存会被保留，不会重新下载)`,
    { modal: true },
    '确认清理并重建'
  );
  if (confirm !== '确认清理并重建') return;

  await runWithStatus(statusBar, () =>
    runBspShell(cleanBuildSnippet(scope.value), channel, { title: 'clean build' })
  );
}

async function openArtifact(fp: string) {
  if (path.extname(fp).toLowerCase() === '.vfat' || /\.(img|bin|dtb|cpio\.gz|elf)$/i.test(fp)) {
    const choice = await vscode.window.showQuickPick(['Reveal in Explorer', 'Copy path'], { placeHolder: path.basename(fp) });
    if (choice === 'Reveal in Explorer') await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(fp));
    else if (choice === 'Copy path') await vscode.env.clipboard.writeText(fp);
    return;
  }
  await vscode.window.showTextDocument(vscode.Uri.file(fp));
}

export function deactivate() {}
