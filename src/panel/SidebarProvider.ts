import * as vscode from 'vscode';
import { PanelController } from './panelCore';

/**
 * Sidebar-resident control panel (WebviewView) — the panel lives in the
 * activity-bar view container, always available without occupying the editor.
 * Reuses the shared PanelController (same UI as the editor panel).
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'quecpiSidebar';
  private controller: PanelController | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'webview')],
    };
    this.controller = new PanelController(webviewView.webview, this.extensionUri);
  }
}
