import * as vscode from 'vscode';
import { runQuiet } from '../build';
import { Cfg } from '../config';
import { t } from '../i18n';
import { isWindows } from '../config';

/**
 * Shared panel controller used by BOTH the editor WebviewPanel (ControlPanel)
 * and the sidebar WebviewView (SidebarProvider).
 *
 * Layout (inspired by UniKnect's tiled control grid): a flat list of
 * first-level COLLAPSIBLE regions (Build / Flash / System Log / ADB / Serial /
 * AT / Audio / Tools / AI). Each region collapses to just its name; expanding
 * one (exclusive accordion) tiles its controls as small icon tiles, with a
 * smooth height + scroll animation. This keeps every control reachable from a
 * narrow sidebar strip, freeing the editor area for terminals/logs.
 */
export interface WebviewLike {
  html: string;
  postMessage(msg: any): Thenable<boolean> | void;
  onDidReceiveMessage(cb: (msg: any) => void): { dispose(): void };
  asWebviewUri(resource: vscode.Uri): vscode.Uri;
  cspSource: string;
}

export class PanelController {
  private webview: WebviewLike;
  private extensionUri: vscode.Uri;

  constructor(webview: WebviewLike, extensionUri: vscode.Uri) {
    this.webview = webview;
    this.extensionUri = extensionUri;
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', 'panel.js'));
    webview.html = this.html(jsUri);
    webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    this.postStatus();
  }

  private onMessage(msg: any) {
    switch (msg.type) {
      case 'run':
        void vscode.commands.executeCommand(msg.command, ...(msg.args ? [msg.args] : []));
        break;
      case 'openChat': void vscode.commands.executeCommand('quecpi.chat'); break;
      case 'openCopilot': void vscode.commands.executeCommand('quecpi.copilot'); break;
      case 'refreshStatus': void this.postStatus(); break;
      case 'popout': void vscode.commands.executeCommand('quecpi.panelPopout'); break;
    }
  }

  private async postStatus() {
    const deploy = Cfg.deployDir();
    const info: Record<string, string> = { container: 'unknown', artifacts: '-', lastBuild: '-' };
    try {
      const ps = await runQuiet('docker', ['ps', '--filter', 'name=quecpi-build', '--format', '{{.Status}}']);
      info.container = ps.trim() ? `up: ${ps.trim()}` : 'down';
    } catch { info.container = 'n/a'; }
    try {
      const fs = await import('fs');
      if (fs.existsSync(deploy)) {
        const files = fs.readdirSync(deploy).filter((f: string) => !f.startsWith('.'));
        info.artifacts = `${files.length} files`;
        const newest = files.map((f: string) => ({ f, t: fs.statSync(`${deploy}/${f}`).mtimeMs }))
          .sort((a: any, b: any) => b.t - a.t)[0];
        if (newest) info.lastBuild = new Date(newest.t).toLocaleString('en-US', { hour12: false });
      }
    } catch { /* ignore */ }
    this.webview.postMessage({ type: 'status', payload: info });
  }

  private html(jsUri: vscode.Uri): string {
    const csp = this.webview.cspSource;
    const codicon = 'https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.36/dist/codicon.css';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline' https://cdn.jsdelivr.net; font-src ${csp} https://cdn.jsdelivr.net; script-src ${csp}; img-src ${csp} data:;">
<link rel="stylesheet" href="${codicon}">
<style>
body{background:var(--vscode-sideBar-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family);padding:6px;font-size:12px;}
h1{font-size:12px;display:flex;align-items:center;gap:5px;margin:0 0 2px;}
h1 .logo{color:var(--vscode-textLink-foreground);}
.sub{color:var(--vscode-descriptionForeground);font-size:9px;margin-bottom:6px;}
.bar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:6px;}
.chip{background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:8px;padding:1px 6px;font-size:9px;color:var(--vscode-descriptionForeground);}
.chip b{color:var(--vscode-editor-foreground);}
.btn{background:var(--vscode-button-secondaryBackground);border:1px solid var(--vscode-panel-border);color:var(--vscode-button-secondaryForeground);border-radius:8px;padding:1px 6px;font-size:9px;cursor:pointer;}
.btn:hover{color:var(--vscode-textLink-foreground);}
/* ── collapsible region (exclusive accordion) ── */
.region{margin-bottom:3px;border:1px solid var(--vscode-panel-border);border-radius:6px;background:var(--vscode-editor-background);overflow:hidden;}
.region-h{display:flex;align-items:center;gap:6px;padding:5px 8px;cursor:pointer;user-select:none;}
.region-h:hover{background:var(--vscode-list-hoverBackground);}
.region-h .ic{font-size:13px;color:var(--vscode-textLink-foreground);}
.region-h .nm{font-weight:600;font-size:11px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.region-h .cnt{color:var(--vscode-descriptionForeground);font-size:8.5px;}
.region-h .arrow{color:var(--vscode-descriptionForeground);font-size:9px;transition:transform .28s cubic-bezier(.4,0,.2,1);}
.region.open .arrow{transform:rotate(180deg);}
/* animated expand/collapse via grid-template-rows */
.region-b{display:grid;grid-template-rows:0fr;transition:grid-template-rows .32s cubic-bezier(.4,0,.2,1);}
.region.open .region-b{grid-template-rows:1fr;}
.region-b-inner{overflow:hidden;min-height:0;}
.region-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(62px,1fr));gap:4px;padding:5px 6px;max-height:210px;overflow-y:auto;}
/* tiled control (UniKnect-inspired hover) */
.tile{background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);border-radius:6px;padding:5px 3px;cursor:pointer;text-align:center;transition:transform .18s cubic-bezier(.34,1.56,.64,1),border-color .18s,box-shadow .18s;overflow:hidden;}
.tile:hover{transform:translateY(-2px) scale(1.05);border-color:var(--vscode-focusBorder);box-shadow:0 4px 12px rgba(0,0,0,.35);}
.tile:active{transform:scale(.95);transition-duration:.05s;}
.tile .ic{font-size:15px;line-height:1;color:var(--vscode-textLink-foreground);}
.tile .lb{font-weight:600;font-size:8.5px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tile.warn .lb{color:var(--vscode-errorForeground);}
.tile.soon{opacity:.42;cursor:not-allowed;}
.tile.soon:hover{transform:none;border-color:var(--vscode-panel-border);box-shadow:none;}
.foot{color:var(--vscode-descriptionForeground);font-size:8px;text-align:center;margin-top:4px;}
</style>
</head>
<body>
<h1><span class="logo codicon codicon-chip"></span> ${t('panel.title')}</h1>
<div class="sub">${t('panel.sub')}</div>

<div class="bar" id="bar">
  <span class="chip">${t('panel.docker')} <b id="st-container">...</b></span>
  <span class="chip">${t('panel.artifacts')} <b id="st-artifacts">...</b></span>
  <button class="btn" id="refresh">${t('panel.refresh')}</button>
  <button class="btn" id="popout" title="Open in a separate column">${t('panel.popout')}</button>
</div>

<!-- ═══ Build ═══ -->
<div class="region open" data-region="build">
  <div class="region-h"><span class="ic codicon codicon-tools"></span><span class="nm">${t('sec.build')}</span><span class="cnt">5</span><span class="arrow codicon codicon-chevron-down"></span></div>
  <div class="region-b"><div class="region-b-inner"><div class="region-tiles">
    <div class="tile" data-cmd="quecpi.buildconfig" title="${t('bld.configure.tip')}"><div class="ic codicon codicon-gear"></div><div class="lb">${t('bld.configure')}</div></div>
    <div class="tile" data-cmd="quecpi.buildall" title="${t('bld.buildall.tip')}"><div class="ic codicon codicon-rocket"></div><div class="lb">${t('bld.buildall')}</div></div>
    <div class="tile warn" data-cmd="quecpi.buildClean" title="${t('bld.clean.tip')}"><div class="ic codicon codicon-clear-all"></div><div class="lb">${t('bld.clean')}</div></div>
    <div class="tile" data-cmd="quecpi.buildkernel" title="${t('bld.kernel.tip')}"><div class="ic codicon codicon-brick"></div><div class="lb">${t('bld.kernel')}</div></div>
    <div class="tile" data-cmd="quecpi.builddtb" title="${t('bld.dtb.tip')}"><div class="ic codicon codicon-type-hierarchy-sub"></div><div class="lb">${t('bld.dtb')}</div></div>
  </div></div></div>
</div>

<!-- ═══ Flash ═══ -->
<div class="region" data-region="flash">
  <div class="region-h"><span class="ic codicon codicon-flame"></span><span class="nm">${t('sec.flash')}</span><span class="cnt">6</span><span class="arrow codicon codicon-chevron-down"></span></div>
  <div class="region-b"><div class="region-b-inner"><div class="region-tiles">
    <div class="tile" data-cmd="quecpi.rebootEdl" title="adb reboot edl - enter EDL mode"><div class="ic codicon codicon-debug-disconnect"></div><div class="lb">${t('flash.edl')}</div></div>
    <div class="tile" data-cmd="quecpi.flashUfs" title="qdl --storage ufs"><div class="ic codicon codicon-save-all"></div><div class="lb">${t('flash.ufs')}</div></div>
    <div class="tile" data-cmd="quecpi.flashEmmc" title="qdl --storage emmc"><div class="ic codicon codicon-save"></div><div class="lb">${t('flash.emmc')}</div></div>
    <div class="tile" data-cmd="quecpi.flash" title="Detect EDL, run qdl"><div class="ic codicon codicon-terminal"></div><div class="lb">${t('flash.qdl')}</div></div>
    <div class="tile" data-cmd="quecpi.buildpackage" title="a_key_generation.sh"><div class="ic codicon codicon-package"></div><div class="lb">${t('flash.package')}</div></div>
    <div class="tile" data-cmd="quecpi.flashHelp" title="QDL / firehose reference"><div class="ic codicon codicon-plug"></div><div class="lb">${t('flash.help')}</div></div>
  </div></div></div>
</div>

<!-- ═══ System Log ═══ -->
<div class="region" data-region="log">
  <div class="region-h"><span class="ic codicon codicon-file-text"></span><span class="nm">${t('dbg.log')}</span><span class="cnt">4</span><span class="arrow codicon codicon-chevron-down"></span></div>
  <div class="region-b"><div class="region-b-inner"><div class="region-tiles">
    <div class="tile" data-cmd="quecpi.adbCmd" data-args="dmesg | tail -100" title="Last 100 kernel lines"><div class="ic codicon codicon-list-flat"></div><div class="lb">${t('dbg.dmesg')}</div></div>
    <div class="tile" data-cmd="quecpi.adbTerm" data-args="dmesg -w" title="Follow kernel log"><div class="ic codicon codicon-eye"></div><div class="lb">${t('dbg.dmesgW')}</div></div>
    <div class="tile" data-cmd="quecpi.adbCmd" data-args="journalctl -n 50 --no-pager" title="Last 50 systemd entries"><div class="ic codicon codicon-list-unordered"></div><div class="lb">${t('dbg.journal')}</div></div>
    <div class="tile" data-cmd="quecpi.adbTerm" data-args="journalctl -f" title="Follow journal"><div class="ic codicon codicon-eye-watch"></div><div class="lb">${t('dbg.journF')}</div></div>
  </div></div></div>
</div>

<!-- ═══ ADB ═══ -->
<div class="region" data-region="adb">
  <div class="region-h"><span class="ic codicon codicon-cellphone"></span><span class="nm">${t('dbg.adb')}</span><span class="cnt">4</span><span class="arrow codicon codicon-chevron-down"></span></div>
  <div class="region-b"><div class="region-b-inner"><div class="region-tiles">
    <div class="tile" data-cmd="quecpi.adbShell" title="Interactive adb shell"><div class="ic codicon codicon-terminal"></div><div class="lb">${t('dbg.shell')}</div></div>
    <div class="tile" data-cmd="quecpi.reboot" title="adb reboot"><div class="ic codicon codicon-refresh"></div><div class="lb">${t('dbg.reboot')}</div></div>
    <div class="tile" data-cmd="quecpi.rebootEdl" title="adb reboot edl"><div class="ic codicon codicon-debug-disconnect"></div><div class="lb">${t('dbg.edl')}</div></div>
    <div class="tile" data-cmd="quecpi.adbCmd" data-args="devices" title="List devices"><div class="ic codicon codicon-device-desktop"></div><div class="lb">${t('dbg.devices')}</div></div>
  </div></div></div>
</div>

<!-- ═══ Serial ═══ -->
<div class="region" data-region="serial">
  <div class="region-h"><span class="ic codicon codicon-vm-connect"></span><span class="nm">${t('dbg.serial')}</span><span class="cnt">1</span><span class="arrow codicon codicon-chevron-down"></span></div>
  <div class="region-b"><div class="region-b-inner"><div class="region-tiles">
    <div class="tile" data-cmd="quecpi.serialMonitor" title="picocom /dev/ttyACM0 @115200"><div class="ic codicon codicon-vm-connect"></div><div class="lb">${t('dbg.serial')}</div></div>
  </div></div></div>
</div>

<!-- ═══ AT Commands ═══ -->
<div class="region" data-region="at">
  <div class="region-h"><span class="ic codicon codicon-keyboard"></span><span class="nm">${t('dbg.at')}</span><span class="cnt">3</span><span class="arrow codicon codicon-chevron-down"></span></div>
  <div class="region-b"><div class="region-b-inner"><div class="region-tiles">
    <div class="tile" data-cmd="quecpi.atSend" title="Input AT command"><div class="ic codicon codicon-edit"></div><div class="lb">${t('dbg.atSend')}</div></div>
    <div class="tile" data-cmd="quecpi.atSend" data-args="AT+QGMR" title="Query version"><div class="ic codicon codicon-info"></div><div class="lb">${t('dbg.atQgmr')}</div></div>
    <div class="tile" data-cmd="quecpi.atSend" data-args="AT+QMAC?" title="Query MAC"><div class="ic codicon codicon-wifi"></div><div class="lb">${t('dbg.atQmac')}</div></div>
  </div></div></div>
</div>

<!-- ═══ Audio ═══ -->
<div class="region" data-region="audio">
  <div class="region-h"><span class="ic codicon codicon-megaphone"></span><span class="nm">${t('dbg.audio')}</span><span class="cnt">5</span><span class="arrow codicon codicon-chevron-down"></span></div>
  <div class="region-b"><div class="region-b-inner"><div class="region-tiles">
    <div class="tile soon" title="Not in the official SDK"><div class="ic codicon codicon-record"></div><div class="lb">${t('dbg.collect')}</div></div>
    <div class="tile" data-cmd="quecpi.adbCmd" data-args="agmplay --speaker /tmp/test.wav" title="agmplay speaker"><div class="ic codicon codicon-unmute"></div><div class="lb">${t('dbg.speaker')}</div></div>
    <div class="tile" data-cmd="quecpi.adbCmd" data-args="agmplay --hdmi /tmp/test.wav" title="agmplay HDMI"><div class="ic codicon codicon-device-desktop"></div><div class="lb">${t('dbg.hdmi')}</div></div>
    <div class="tile" data-cmd="quecpi.adbCmd" data-args="agmplay --dp /tmp/test.wav" title="agmplay DP"><div class="ic codicon codicon-project"></div><div class="lb">${t('dbg.dp')}</div></div>
    <div class="tile" data-cmd="quecpi.adbTerm" data-args="tinymix" title="Interactive mixer"><div class="ic codicon codicon-settings-gear"></div><div class="lb">${t('dbg.tinymix')}</div></div>
  </div></div></div>
</div>

<!-- ═══ Tools ═══ -->
<div class="region" data-region="tools">
  <div class="region-h"><span class="ic codicon codicon-camera"></span><span class="nm">${t('dbg.tools')}</span><span class="cnt">6</span><span class="arrow codicon codicon-chevron-down"></span></div>
  <div class="region-b"><div class="region-b-inner"><div class="region-tiles">
    <div class="tile" data-cmd="quecpi.screenshot" title="screencap + pull"><div class="ic codicon codicon-device-camera"></div><div class="lb">${t('dbg.screenshot')}</div></div>
    <div class="tile" data-cmd="quecpi.adbCmd" data-args="dumpsys SurfaceFlinger | grep -i fps" title="Check FPS"><div class="ic codicon codicon-pulse"></div><div class="lb">${t('dbg.fps')}</div></div>
    <div class="tile soon" title="Not in the official SDK"><div class="ic codicon codicon-flame"></div><div class="lb">${t('dbg.gpuStress')}</div></div>
    <div class="tile soon" title="Not in the official SDK"><div class="ic codicon codicon-graph"></div><div class="lb">${t('dbg.gpuMon')}</div></div>
    <div class="tile soon" title="Not in the official SDK"><div class="ic codicon codicon-radio-tower"></div><div class="lb">${t('dbg.diagStart')}</div></div>
    <div class="tile soon" title="Not in the official SDK"><div class="ic codicon codicon-stop-circle"></div><div class="lb">${t('dbg.diagStop')}</div></div>
  </div></div></div>
</div>

<!-- ═══ AI ═══ -->
<div class="region" data-region="ai">
  <div class="region-h"><span class="ic codicon codicon-comment-discussion"></span><span class="nm">${t('sec.ai')}</span><span class="cnt">2</span><span class="arrow codicon codicon-chevron-down"></span></div>
  <div class="region-b"><div class="region-b-inner"><div class="region-tiles">
    <div class="tile" data-openchat="1" title="${t('ai.chat.tip')}"><div class="ic codicon codicon-comment-discussion"></div><div class="lb">${t('ai.chat')}</div></div>
    <div class="tile" data-opencopilot="1" title="Toggle GitHub Copilot Chat"><div class="ic codicon codicon-copilot"></div><div class="lb">Copilot</div></div>
  </div></div></div>
</div>

<div class="foot">${t('panel.foot')}</div>
<script src="${jsUri}"></script>
</body>
</html>`;
  }
}
