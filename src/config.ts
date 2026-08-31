import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/** True when running in Windows VS Code (vs WSL/Linux). */
export const isWindows: boolean = process.platform === 'win32';

/**
 * Central settings access + a few filesystem helpers for the QuecPi BSP.
 */
export class Cfg {
  static bspPath(): string {
    const p = vscode.workspace.getConfiguration('quecpi').get<string>('bspPath', '');
    if (p) return p;
    // Fall back to any open workspace folder that looks like the BSP.
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return folder && fs.existsSync(path.join(folder, 'quectel_build')) ? folder : '';
  }

  static mode(): 'docker' | 'local' {
    return vscode.workspace.getConfiguration('quecpi.build').get<'docker' | 'local'>('mode', 'docker');
  }

  static container(): string {
    return vscode.workspace.getConfiguration('quecpi.build').get<string>('container', 'quecpi-build');
  }

  static projectRev(): string {
    return vscode.workspace.getConfiguration('quecpi.build').get<string>('projectRev', '');
  }

  static custName(): string {
    return vscode.workspace.getConfiguration('quecpi.build').get<string>('custName', 'STD');
  }

  static projectName(): string {
    return 'QSM565DWF';
  }

  static threads(): number {
    return vscode.workspace.getConfiguration('quecpi.build').get<number>('threads', 12);
  }

  static llvmJobs(): number {
    return vscode.workspace.getConfiguration('quecpi.build').get<number>('llvmJobs', 4);
  }

  static serialPort(): string {
    return vscode.workspace.getConfiguration('quecpi.serial').get<string>('port', '/dev/ttyUSB0');
  }

  static serialBaud(): number {
    return vscode.workspace.getConfiguration('quecpi.serial').get<number>('baud', 115200);
  }

  /** adb binary path — defaults to 'adb' on PATH; can point to a Windows adb.exe. */
  static adbPath(): string {
    return vscode.workspace.getConfiguration('quecpi.adb').get<string>('path', 'adb');
  }

  static chatBaseUrl(): string {
    return vscode.workspace.getConfiguration('quecpi.chat').get<string>('baseUrl', 'https://api.deepseek.com');
  }

  static chatApiKey(): string {
    const k = vscode.workspace.getConfiguration('quecpi.chat').get<string>('apiKey', '');
    if (k) return k;
    return process.env.QUECPI_API_KEY || process.env.DEEPSEEK_API_KEY || '';
  }

  static chatModel(): string {
    return vscode.workspace.getConfiguration('quecpi.chat').get<string>('model', 'deepseek-chat');
  }

  static chatSystemPrompt(): string {
    return vscode.workspace.getConfiguration('quecpi.chat').get<string>(
      'systemPrompt',
      'You are QuecPi Bot, an embedded Linux / Yocto / Qualcomm BSP expert embedded in VS Code for the QuecPi H1 (QCM6490) board. Answer concisely and cite the file paths you rely on.'
    );
  }

  /** Comma-separated model list for the chat dropdown (quecpi.chat.models). */
  static chatModels(): string[] {
    const s = vscode.workspace.getConfiguration('quecpi.chat').get<string>('models', '');
    if (s && s.trim()) {
      return s.split(',').map((x) => x.trim()).filter(Boolean);
    }
    return [
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-chat',
      'qwen3.7-max',
      'qwen3.7-plus',
      'qwen3-coder-plus',
      'glm-5.2',
    ];
  }

  static chatPresetId(): string {
    return vscode.workspace.getConfiguration('quecpi.chat').get<string>('preset', 'code');
  }

  /** URL of the RUNNING DeepSeek Harness web server (agent-preset API). */
  static harnessUrl(): string {
    return vscode.workspace.getConfiguration('quecpi.harness').get<string>('url', 'http://127.0.0.1:3080');
  }

  /** Fallback presets matching the harness's built-in modes (used when offline). */
  static chatPresets(): { id: string; label: string; prompt: string }[] {
    const builtins: { id: string; label: string; prompt: string }[] = [
      {
        id: 'standard',
        label: 'Standard',
        prompt:
          'You are QuecPi Bot (标准模式): 功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。面向 QuecPi H1 (QCM6490) BSP，回答简洁并引用文件路径与命令。',
      },
      {
        id: 'code',
        label: 'PTC',
        prompt:
          'You are QuecPi Bot (PTC 模式): 具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。面向 QuecPi H1 (QCM6490) BSP。',
      },
      {
        id: 'minimal',
        label: 'Minimal',
        prompt: 'You are a helpful software engineer assistant. (极简模式：仅持久 bash 与 str_replace_editor 双工具)',
      },
      {
        id: 'cordis',
        label: 'Creator',
        prompt:
          'You are QuecPi Bot (创造模式): 用于创建自定义 Agent preset，具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。',
      },
    ];
    // merge user-defined presets (quecpi.chat.presets), overriding same ids
    const custom = Cfg.customPresets();
    const map = new Map(builtins.map((p) => [p.id, p]));
    for (const p of custom) map.set(p.id, p);
    return [...map.values()];
  }

  /** User-defined presets from the quecpi.chat.presets setting (JSON array). */
  static customPresets(): { id: string; label: string; prompt: string }[] {
    const raw = vscode.workspace.getConfiguration('quecpi.chat').get<string>('presets', '');
    if (!raw || !raw.trim()) return [];
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter((p) => p && typeof p.id === 'string' && typeof p.label === 'string' && typeof p.prompt === 'string');
    } catch {
      return [];
    }
  }

  static promptForPreset(id: string): string {
    const list = Cfg.chatPresets();
    return list.find((p) => p.id === id)?.prompt ?? list[0].prompt;
  }

  /** deploy/images/qcm6490-idp under the build dir */
  static deployDir(): string {
    return path.join(Cfg.bspPath(), 'build-qcom-wayland', 'tmp-glibc', 'deploy', 'images', 'qcm6490-idp');
  }

  /** container path mirrors host path via the /work bind mount */
  static containerPath(hostPath: string): string {
    const bsp = Cfg.bspPath();
    if (hostPath.startsWith(bsp)) return '/work' + hostPath.slice(bsp.length);
    return hostPath;
  }
}
