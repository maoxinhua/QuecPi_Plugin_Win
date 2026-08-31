import * as vscode from 'vscode';
import { PanelController } from './panelCore';

/**
 * Editor-area control panel (WebviewPanel). Thin wrapper over the shared
 * PanelController; supports pop-out to a separate editor column.
 */
export class ControlPanel {
  static current: ControlPanel | undefined;
  static popoutPanel: ControlPanel | undefined;
  private panel: vscode.WebviewPanel;
  private controller: PanelController;

  static create(extensionUri: vscode.Uri) {
    if (ControlPanel.current) { ControlPanel.current.panel.reveal(vscode.ViewColumn.One); return ControlPanel.current; }
    const panel = vscode.window.createWebviewPanel('quecpiControl', 'QuecPi Panel', vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview')],
    });
    ControlPanel.current = new ControlPanel(panel, extensionUri);
    panel.onDidDispose(() => { ControlPanel.current = undefined; });
    return ControlPanel.current;
  }

  static popout(extensionUri: vscode.Uri) {
    const panel = vscode.window.createWebviewPanel('quecpiControlPop', 'QuecPi Panel (Detached)', vscode.ViewColumn.Beside, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview')],
    });
    ControlPanel.popoutPanel = new ControlPanel(panel, extensionUri);
    panel.onDidDispose(() => { ControlPanel.popoutPanel = undefined; });
    return ControlPanel.popoutPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.controller = new PanelController(panel.webview, extensionUri);
  }
}
