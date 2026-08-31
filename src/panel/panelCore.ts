import * as vscode from 'vscode';
import { runQuiet } from '../build';
import { Cfg } from '../config';
import { t } from '../i18n';
import { isWindows } from '../config';

/**
 * Shared panel controller used by BOTH the editor WebviewPanel (ControlPanel)
 * and the sidebar WebviewView (SidebarProvider). Renders the compact tile
 * dashboard with Codicon icons + VS Code theme variables (light/dark aware),
 * and handles refresh / run / chat / popout messages.
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
/* VS Code theme variables — light/dark aware */
body{background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family);padding:8px;font-size:12px;}
h1{font-size:14px;display:flex;align-items:center;gap:6px;margin-bottom:2px;}
h1 .logo{color:var(--vscode-textLink-foreground);}
.sub{color:var(--vscode-descriptionForeground);font-size:10px;margin-bottom:8px;}
.bar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:8px;}
.chip{background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);border-radius:10px;padding:2px 8px;font-size:10px;color:var(--vscode-descriptionForeground);}
.chip b{color:var(--vscode-editor-foreground);}
.btn{background:var(--vscode-button-secondaryBackground);border:1px solid var(--vscode-panel-border);color:var(--vscode-button-secondaryForeground);border-radius:10px;padding:2px 8px;font-size:10px;cursor:pointer;}
.btn:hover{color:var(--vscode-textLink-foreground);}
.sec{margin-bottom:8px;border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-sideBar-background);overflow:hidden;}
.sec-h{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer;user-select:none;font-weight:600;font-size:11px;}
.sec-h .chev{transition:transform .15s;color:var(--vscode-descriptionForeground);font-size:9px;}
.sec.collapsed .chev{transform:rotate(-90deg);}
.sec.collapsed .sec-b{display:none;}
.sec-h .tag{margin-left:auto;color:var(--vscode-descriptionForeground);font-size:9px;}
.sec-b{padding:6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(66px,1fr));gap:5px;}
.tile{background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:6px;padding:6px 4px;cursor:pointer;transition:all .15s;text-align:center;}
.tile:hover{background:var(--vscode-list-hoverBackground);border-color:var(--vscode-focusBorder);transform:translateY(-1px);}
.tile .ic{font-size:15px;line-height:1;color:var(--vscode-textLink-foreground);}
.tile .lb{font-weight:600;font-size:9.5px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tile.warn .lb{color:var(--vscode-errorForeground);}
.sc.soon,.tile.soon{opacity:.45;cursor:not-allowed;}
.sc.soon:hover,.tile.soon:hover{background:var(--vscode-sideBar-background);border-color:var(--vscode-panel-border);transform:none;}
.cg{grid-column:1/-1;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:6px;overflow:hidden;}
.cg-h{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer;transition:background .12s;}
.cg-h:hover{background:var(--vscode-list-hoverBackground);}
.cg-h .ic{font-size:15px;color:var(--vscode-textLink-foreground);}
.cg-h .lb{font-weight:600;font-size:10px;flex:1;}
.cg-h .hint{color:var(--vscode-descriptionForeground);font-size:9px;text-align:right;}
.cg-h .arrow{color:var(--vscode-descriptionForeground);font-size:9px;transition:transform .2s;}
.cg.open .arrow{transform:rotate(180deg);}
.cg-b{display:none;padding:5px;border-top:1px solid var(--vscode-panel-border);}
.cg.open .cg-b{display:grid;grid-template-columns:repeat(auto-fill,minmax(56px,1fr));gap:4px;}
.sub{background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);border-radius:5px;padding:5px 3px;cursor:pointer;transition:all .12s;text-align:center;}
.sub:hover{background:var(--vscode-list-hoverBackground);border-color:var(--vscode-focusBorder);}
.sub .sl{font-weight:600;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.foot{color:var(--vscode-descriptionForeground);font-size:9px;text-align:center;margin-top:6px;}
</style>
</head>
<body>
<h1><span class="logo codicon codicon-chip"></span> ${t('panel.title')}</h1>
<div class="sub">${t('panel.sub')}</div>

<div class="bar" id="bar">
  <span class="chip">${t('panel.docker')} <b id="st-container">...</b></span>
  <span class="chip">${t('panel.artifacts')} <b id="st-artifacts">...</b></span>
  <span class="chip">${t('panel.last')} <b id="st-last">...</b></span>
  <button class="btn" id="refresh">${t('panel.refresh')}</button>
  <button class="btn" id="popout" title="Open in a separate column, then Move-to-New-Window for an OS window">${t('panel.popout')}</button>
</div>

<div class="sec" id="sec-build">
  <div class="sec-h"><span class="chev codicon codicon-chevron-down"></span> ${t('sec.build')} <span class="tag">${isWindows ? 'Windows 版不支持构建 — 在 WSL/Linux 构建' : 'Yocto'}</span></div>
  <div class="sec-b">
    <div class="tile" data-cmd="quecpi.buildconfig" title="${t('bld.configure.tip')}"><div class="ic codicon codicon-gear"></div><div class="lb">${t('bld.configure')}</div></div>
    <div class="tile" data-cmd="quecpi.buildall" title="${t('bld.buildall.tip')}"><div class="ic codicon codicon-rocket"></div><div class="lb">${t('bld.buildall')}</div></div>
    <div class="tile${isWindows ? ' soon' : ''} warn" data-cmd="quecpi.buildClean" title="${t('bld.clean.tip')}"><div class="ic codicon codicon-clear-all"></div><div class="lb">${t('bld.clean')}</div></div>
    <div class="tile" data-cmd="quecpi.buildkernel" title="${t('bld.kernel.tip')}"><div class="ic codicon codicon-brick"></div><div class="lb">${t('bld.kernel')}</div></div>
    <div class="tile" data-cmd="quecpi.builddtb" title="${t('bld.dtb.tip')}"><div class="ic codicon codicon-type-hierarchy-sub"></div><div class="lb">${t('bld.dtb')}</div></div>
  </div>
</div>

<div class="sec" id="sec-flash">
  <div class="sec-h"><span class="chev codicon codicon-chevron-down"></span> ${t('sec.flash')} <span class="tag">EDL / Package</span></div>
  <div class="sec-b">
    <div class="cg" id="cg-flash">
      <div class="cg-h"><span class="ic codicon codicon-flame"></span><span class="lb">${t('flash.title')}</span><span class="hint">${t('flash.hint')}</span><span class="arrow codicon codicon-chevron-down"></span></div>
      <div class="cg-b">
        <div class="sub" data-cmd="quecpi.rebootEdl" title="adb reboot edl"><div class="sl">${t('flash.edl')}</div></div>
        <div class="sub" data-cmd="quecpi.flashUfs" title="flash.sh ufs"><div class="sl">${t('flash.ufs')}</div></div>
        <div class="sub" data-cmd="quecpi.flashEmmc" title="flash.sh emmc"><div class="sl">${t('flash.emmc')}</div></div>
        <div class="sub" data-cmd="quecpi.flash" title="Detect EDL, run qdl"><div class="sl">${t('flash.qdl')}</div></div>
      </div>
    </div>
    <div class="tile" data-cmd="quecpi.buildpackage" title="a_key_generation.sh"><div class="ic codicon codicon-package"></div><div class="lb">${t('flash.package')}</div></div>
    <div class="tile" data-cmd="quecpi.flashHelp" title="QDL / firehose reference"><div class="ic codicon codicon-plug"></div><div class="lb">${t('flash.help')}</div></div>
  </div>
</div>

<div class="sec" id="sec-debug">
  <div class="sec-h"><span class="chev codicon codicon-chevron-down"></span> ${t('sec.debug')} <span class="tag">adb / AT / Audio</span></div>
  <div class="sec-b">
    <div class="cg" id="cg-log">
      <div class="cg-h"><span class="ic codicon codicon-file-text"></span><span class="lb">${t('dbg.log')}</span><span class="hint">dmesg / journalctl</span><span class="arrow codicon codicon-chevron-down"></span></div>
      <div class="cg-b">
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="dmesg | tail -100" title="Last 100 kernel lines"><div class="sl">${t('dbg.dmesg')}</div></div>
        <div class="sub" data-cmd="quecpi.adbTerm" data-args="dmesg -w" title="Follow kernel log"><div class="sl">${t('dbg.dmesgW')}</div></div>
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="journalctl -n 50 --no-pager" title="Last 50 systemd entries"><div class="sl">${t('dbg.journal')}</div></div>
        <div class="sub" data-cmd="quecpi.adbTerm" data-args="journalctl -f" title="Follow journal"><div class="sl">${t('dbg.journF')}</div></div>
      </div>
    </div>
    <div class="cg" id="cg-adb">
      <div class="cg-h"><span class="ic codicon codicon-cellphone"></span><span class="lb">${t('dbg.adb')}</span><span class="hint">shell / reboot / EDL</span><span class="arrow codicon codicon-chevron-down"></span></div>
      <div class="cg-b">
        <div class="sub" data-cmd="quecpi.adbShell" title="Interactive adb shell"><div class="sl">${t('dbg.shell')}</div></div>
        <div class="sub" data-cmd="quecpi.reboot" title="adb reboot"><div class="sl">${t('dbg.reboot')}</div></div>
        <div class="sub" data-cmd="quecpi.rebootEdl" title="adb reboot edl"><div class="sl">${t('dbg.edl')}</div></div>
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="devices" title="List devices"><div class="sl">${t('dbg.devices')}</div></div>
      </div>
    </div>
    <div class="tile" data-cmd="quecpi.serialMonitor" title="picocom /dev/ttyUSB0 @115200"><div class="ic codicon codicon-vm-connect"></div><div class="lb">${t('dbg.serial')}</div></div>
    <div class="cg" id="cg-at">
      <div class="cg-h"><span class="ic codicon codicon-keyboard"></span><span class="lb">${t('dbg.at')}</span><span class="hint">serial AT</span><span class="arrow codicon codicon-chevron-down"></span></div>
      <div class="cg-b">
        <div class="sub" data-cmd="quecpi.atSend" title="Input AT command"><div class="sl">${t('dbg.atSend')}</div></div>
        <div class="sub" data-cmd="quecpi.atSend" data-args="AT+QGMR" title="Query version"><div class="sl">${t('dbg.atQgmr')}</div></div>
        <div class="sub" data-cmd="quecpi.atSend" data-args="AT+QMAC?" title="Query MAC"><div class="sl">${t('dbg.atQmac')}</div></div>
      </div>
    </div>
    <div class="cg" id="cg-audio">
      <div class="cg-h"><span class="ic codicon codicon-megaphone"></span><span class="lb">${t('dbg.audio')}</span><span class="hint">log / agmplay / mix</span><span class="arrow codicon codicon-chevron-down"></span></div>
      <div class="cg-b">
        <div class="sub soon" title="Not in the official SDK (quectel_build/tools/collect_audio_logs.sh missing)"><div class="sl">${t('dbg.collect')}</div></div>
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="agmplay --speaker /tmp/test.wav" title="agmplay speaker"><div class="sl">${t('dbg.speaker')}</div></div>
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="agmplay --hdmi /tmp/test.wav" title="agmplay HDMI"><div class="sl">${t('dbg.hdmi')}</div></div>
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="agmplay --dp /tmp/test.wav" title="agmplay DP"><div class="sl">${t('dbg.dp')}</div></div>
        <div class="sub" data-cmd="quecpi.adbTerm" data-args="tinymix" title="Interactive mixer"><div class="sl">${t('dbg.tinymix')}</div></div>
      </div>
    </div>
    <div class="cg" id="cg-tools">
      <div class="cg-h"><span class="ic codicon codicon-camera"></span><span class="lb">${t('dbg.tools')}</span><span class="hint">shot / FPS / GPU / diag</span><span class="arrow codicon codicon-chevron-down"></span></div>
      <div class="cg-b">
        <div class="sub" data-cmd="quecpi.screenshot" title="screencap + pull"><div class="sl">${t('dbg.screenshot')}</div></div>
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="dumpsys SurfaceFlinger | grep -i fps" title="Check FPS"><div class="sl">${t('dbg.fps')}</div></div>
        <div class="sub soon" title="Not in the official SDK (quectel_build/tools/gpu_stress.sh missing)"><div class="sl">${t('dbg.gpuStress')}</div></div>
        <div class="sub soon" title="Not in the official SDK (quectel_build/tools/gpu_monitor.sh missing)"><div class="sl">${t('dbg.gpuMon')}</div></div>
        <div class="sub soon" title="Not in the official SDK (smart_adb_qxdm_log missing)"><div class="sl">${t('dbg.diagStart')}</div></div>
        <div class="sub soon" title="Not in the official SDK (smart_adb_qxdm_log missing)"><div class="sl">${t('dbg.diagStop')}</div></div>
      </div>
    </div>
  </div>
</div>

<div class="sec" id="sec-ai">
  <div class="sec-h"><span class="chev codicon codicon-chevron-down"></span> ${t('sec.ai')} <span class="tag">Chat</span></div>
  <div class="sec-b">
    <div class="tile" data-openchat="1" title="${t('ai.chat.tip')}"><div class="ic codicon codicon-comment-discussion"></div><div class="lb">${t('ai.chat')}</div></div>
    <div class="tile" data-opencopilot="1" title="Toggle GitHub Copilot Chat"><div class="ic codicon codicon-copilot"></div><div class="lb">Copilot</div></div>
  </div>
</div>

<div class="foot">${t('panel.foot')}</div>
<script src="${jsUri}"></script>
</body>
</html>`;
  }
}
