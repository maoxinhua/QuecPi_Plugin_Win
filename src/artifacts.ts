import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Cfg } from './config';

/** Tree view of deploy/images/qcm6490-idp artifacts + tmp-glibc work dirs. */
export class ArtifactsProvider implements vscode.TreeDataProvider<ArtifactNode> {
  private _onDidChange = new vscode.EventEmitter<ArtifactNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh() {
    this._onDidChange.fire(null);
  }

  getTreeItem(element: ArtifactNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ArtifactNode): Thenable<ArtifactNode[]> {
    if (!element) {
      const deploy = Cfg.deployDir();
      if (!fs.existsSync(deploy)) {
        return Promise.resolve([
          new ArtifactNode('(build dir not ready yet — run Build All first)', vscode.TreeItemCollapsibleState.None),
        ]);
      }
      return this.dir(deploy);
    }
    return this.dir(element.fullPath);
  }

  private dir(fullPath: string): Thenable<ArtifactNode[]> {
    return new Promise((resolve) => {
      fs.readdir(fullPath, { withFileTypes: true }, (err, entries) => {
        if (err) return resolve([]);
        const nodes = entries
          .filter((e) => e.name !== '.')
          .map((e) => {
            const fp = path.join(fullPath, e.name);
            const isDir = e.isDirectory();
            let size = '';
            if (!isDir) {
              try {
                const st = fs.statSync(fp);
                size = humanSize(st.size);
              } catch {
                /* ignore */
              }
            }
            const label = isDir ? e.name : `${e.name}  ${size}`;
            const node = new ArtifactNode(label, isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
            node.fullPath = fp;
            node.isDir = isDir;
            node.iconPath = isDir ? new vscode.ThemeIcon('folder') : new vscode.ThemeIcon('file');
            node.command = isDir ? undefined : { command: 'quecpi.openArtifact', title: 'Open', arguments: [fp] };
            return node;
          })
          .sort((a, b) => Number(b.isDir) - Number(a.isDir) || String(a.label).localeCompare(String(b.label)));
        resolve(nodes);
      });
    });
  }
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const k = bytes / 1024;
  if (k < 1024) return `${k.toFixed(1)} KB`;
  const m = k / 1024;
  if (m < 1024) return `${m.toFixed(1)} MB`;
  return `${(m / 1024).toFixed(2)} GB`;
}

export class ArtifactNode extends vscode.TreeItem {
  fullPath = '';
  isDir = false;
  constructor(label: string, collapsible: vscode.TreeItemCollapsibleState) {
    super(label, collapsible);
  }
}

/** Quick-build task buttons. */
export class BuildTasksProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<vscode.TreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  refresh() {
    this._onDidChange.fire(null);
  }
  getTreeItem(e: vscode.TreeItem): vscode.TreeItem {
    return e;
  }
  getChildren(): vscode.TreeItem[] {
    const mk = (label: string, cmd: string, desc: string) => {
      const t = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      t.description = desc;
      t.command = { command: cmd, title: label };
      t.iconPath = new vscode.ThemeIcon('tools');
      return t;
    };
    return [
      mk('🎛 打开控制面板', 'quecpi.panel', '构建/烧录/调试 一体化面板'),
      mk('🚀 Build All (buildall)', 'quecpi.buildall', 'bitbake qcom-multimedia-image'),
      mk('⚙ Configure (buildconfig)', 'quecpi.buildconfig', 'QSM565DWF + rev + STD'),
      mk('🧹 Clean Build (从头重建)', 'quecpi.buildClean', '删除编译中间物后完整重建'),
      mk('📦 Package / 制作烧录包', 'quecpi.buildpackage', 'a_key_generation.sh'),
      mk('🔥 烧录到板 (Flash)', 'quecpi.flash', 'EDL 检测 + QDL 烧录'),
      mk('💬 AI Chat', 'quecpi.chat', 'ask the BSP anything'),
    ];
  }
}

/** Find bitbake task logs for a recipe. */
export async function pickBitbakeLog(): Promise<string | undefined> {
  const tmp = path.join(Cfg.bspPath(), 'build-qcom-wayland', 'tmp-glibc', 'work');
  if (!fs.existsSync(tmp)) {
    vscode.window.showWarningMessage('QuecPi: tmp-glibc/work not found — run a build first.');
    return undefined;
  }
  // walk two levels: <arch>/<recipe>/<version>/temp/log.do_*
  const logs: string[] = [];
  try {
    for (const arch of fs.readdirSync(tmp)) {
      const archDir = path.join(tmp, arch);
      if (!fs.statSync(archDir).isDirectory()) continue;
      for (const recipe of fs.readdirSync(archDir)) {
        const rDir = path.join(archDir, recipe);
        if (!fs.statSync(rDir).isDirectory()) continue;
        for (const ver of fs.readdirSync(rDir)) {
          const temp = path.join(rDir, ver, 'temp');
          if (!fs.existsSync(temp)) continue;
          for (const f of fs.readdirSync(temp)) {
            if (f.startsWith('log.do_') && !f.endsWith('.log')) logs.push(path.join(temp, f));
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  if (logs.length === 0) {
    vscode.window.showWarningMessage('QuecPi: no log.do_* files found yet.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    logs.map((p) => {
      const rel = p.replace(tmp + '/', '');
      const task = path.basename(p).replace('log.do_', 'do_');
      return { label: `${task}  —  ${rel.split('/').slice(0, 2).join('/')}`, description: rel, detail: p };
    }),
    { placeHolder: 'Pick a bitbake task log' }
  );
  return picked?.detail;
}
