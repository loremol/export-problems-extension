import assert from 'node:assert/strict';
import Module = require('node:module');
import * as path from 'node:path';
import { type TestContext } from 'node:test';
import type * as vscode from 'vscode';
import { createRange, TestUri } from './vscodeMock';

export type ExportConfiguration = {
  minimumSeverity: 'Hint' | 'Information' | 'Warning' | 'Error';
  groupBy: 'file' | 'severity' | 'flat-table';
  includeSummary: boolean;
  summaryTitle: string;
  includeExportDate: boolean;
  includeProblemCount: boolean;
  includeSource: boolean;
  includeColumn: boolean;
  defaultFileName: string;
  outputMode: 'save-dialog' | 'workspace-file' | 'clipboard';
  openAfterExport: boolean;
};

export type VscodeApi = {
  DiagnosticSeverity: {
    Error: vscode.DiagnosticSeverity.Error;
    Warning: vscode.DiagnosticSeverity.Warning;
    Information: vscode.DiagnosticSeverity.Information;
    Hint: vscode.DiagnosticSeverity.Hint;
  };
  Uri: Pick<typeof vscode.Uri, 'file' | 'joinPath'>;
  commands: {
    registerCommand(command: string, callback: () => unknown): vscode.Disposable;
  };
  env: {
    clipboard: Pick<vscode.Clipboard, 'writeText'>;
  };
  languages: {
    getDiagnostics(): [vscode.Uri, vscode.Diagnostic[]][];
  };
  window: {
    showSaveDialog(options?: vscode.SaveDialogOptions): Thenable<vscode.Uri | undefined>;
    showErrorMessage(message: string): Thenable<string | undefined>;
    showInformationMessage(message: string): Thenable<string | undefined>;
    showWarningMessage(message: string): Thenable<string | undefined>;
    showTextDocument(document: vscode.TextDocument): Thenable<vscode.TextEditor>;
  };
  workspace: {
    workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;
    getConfiguration(section?: string): vscode.WorkspaceConfiguration;
    asRelativePath(pathOrUri: string | vscode.Uri, includeWorkspaceFolder?: boolean): string;
    fs: Pick<vscode.FileSystem, 'writeFile'>;
    openTextDocument(uri: vscode.Uri): Thenable<vscode.TextDocument>;
  };
};

export class TestConfiguration implements vscode.WorkspaceConfiguration {
  constructor(private readonly values: Readonly<Partial<ExportConfiguration>>) {}

  get<T>(section: string): T | undefined;
  get<T>(section: string, defaultValue: T): T;
  get<T>(section: string, defaultValue?: T): T | undefined {
    const value: unknown = this.values[section as keyof ExportConfiguration];
    // VS Code's generic configuration API requires the caller to choose T.
    return (value === undefined ? defaultValue : value) as T | undefined;
  }

  has(section: string): boolean {
    return Object.hasOwn(this.values, section);
  }

  inspect<T>(_section: string): undefined {
    return undefined;
  }

  update(
    _section: string,
    _value: unknown,
    _configurationTarget?: vscode.ConfigurationTarget | boolean | null,
    _overrideInLanguage?: boolean
  ): Thenable<void> {
    return Promise.resolve();
  }
}

export type HostOverrides = {
  configuration?: Partial<ExportConfiguration>;
  diagnostics?: vscode.Diagnostic[];
  diagnosticEntries?: [vscode.Uri, vscode.Diagnostic[]][];
  relativePath?: string;
  saveDialogResult?: vscode.Uri;
};

export type Write = { uri: vscode.Uri; content: Uint8Array };

export type TestHost = {
  vscode: VscodeApi;
  writes: Write[];
  saveDialogs: vscode.SaveDialogOptions[];
  errorMessages: string[];
  informationMessages: string[];
  warningMessages: string[];
  openedDocuments: vscode.Uri[];
  shownDocuments: vscode.Uri[];
  getRegisteredCommand(): () => unknown;
  getClipboardText(): string | undefined;
};

export function createVscode(
  workspaceRoot: string,
  configuredPath: string | undefined,
  overrides: HostOverrides = {}
): TestHost {
  const writes: Write[] = [];
  const saveDialogs: vscode.SaveDialogOptions[] = [];
  const errorMessages: string[] = [];
  const informationMessages: string[] = [];
  const warningMessages: string[] = [];
  const openedDocuments: vscode.Uri[] = [];
  const shownDocuments: vscode.Uri[] = [];
  const diagnostics: vscode.Diagnostic[] = overrides.diagnostics ?? [{
    severity: 0,
    range: createRange(),
    message: 'Example problem',
  }];
  const diagnosticEntries: [vscode.Uri, vscode.Diagnostic[]][] =
    overrides.diagnosticEntries ?? [
      [TestUri.file(path.join(workspaceRoot, 'source.ts')), diagnostics],
    ];
  const configuration: Partial<ExportConfiguration> = overrides.configuration ?? {};
  let clipboardText: string | undefined;
  let registeredCommand: (() => unknown) | undefined;

  const vscodeApi: VscodeApi = {
    DiagnosticSeverity: {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3,
    },
    Uri: TestUri,
    commands: {
      registerCommand(_name, command) {
        registeredCommand = command;
        return { dispose() {} };
      },
    },
    env: {
      clipboard: {
        async writeText(content) {
          clipboardText = content;
        },
      },
    },
    languages: {
      getDiagnostics() {
        return diagnosticEntries;
      },
    },
    window: {
      async showSaveDialog(options) {
        saveDialogs.push(options ?? {});
        return overrides.saveDialogResult;
      },
      async showErrorMessage(message) {
        errorMessages.push(message);
        return undefined;
      },
      async showInformationMessage(message) {
        informationMessages.push(message);
        return undefined;
      },
      async showWarningMessage(message) {
        warningMessages.push(message);
        return undefined;
      },
      async showTextDocument(document): Promise<vscode.TextEditor> {
        shownDocuments.push(document.uri);
        return { document } as vscode.TextEditor;
      },
    },
    workspace: {
      workspaceFolders: [{
        uri: TestUri.file(workspaceRoot),
        name: path.basename(workspaceRoot),
        index: 0,
      }],
      getConfiguration() {
        return new TestConfiguration({
          defaultFileName: configuredPath,
          openAfterExport: false,
          outputMode: 'workspace-file',
          ...configuration,
        });
      },
      asRelativePath(uri, includeWorkspaceFolder = false) {
        if (typeof uri === 'string') {
          return uri;
        }
        const owningFolder = vscodeApi.workspace.workspaceFolders?.find((folder) => {
          const relativePath = path.relative(folder.uri.fsPath, uri.fsPath);
          return relativePath === ''
            || (!path.isAbsolute(relativePath)
              && relativePath !== '..'
              && !relativePath.startsWith(`..${path.sep}`));
        });
        const relativePath = overrides.relativePath
          ?? path.relative(owningFolder?.uri.fsPath ?? workspaceRoot, uri.fsPath);
        return includeWorkspaceFolder && owningFolder
          ? path.join(owningFolder.name, relativePath)
          : relativePath;
      },
      fs: {
        async writeFile(uri, content) {
          writes.push({ uri, content });
        },
      },
      async openTextDocument(uri): Promise<vscode.TextDocument> {
        openedDocuments.push(uri);
        return { uri } as vscode.TextDocument;
      },
    },
  };

  return {
    vscode: vscodeApi,
    writes,
    saveDialogs,
    errorMessages,
    informationMessages,
    warningMessages,
    openedDocuments,
    shownDocuments,
    getRegisteredCommand() {
      assert.ok(registeredCommand, 'extension command was not registered');
      return registeredCommand;
    },
    getClipboardText() {
      return clipboardText;
    },
  };
}

export type ExtensionModule = typeof import('../src/extension');
export type CommonJsLoader = {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
};

export function loadExtension(vscodeApi: VscodeApi): ExtensionModule {
  const extensionPath = require.resolve('../src/extension');
  const exportCommandPath = require.resolve('../src/exportProblemsToMarkdown');
  delete require.cache[extensionPath];
  delete require.cache[exportCommandPath];

  // Node does not publish _load, so the assertion is isolated to this interception boundary.
  const commonJsLoader = Module as unknown as CommonJsLoader;
  const originalLoad = commonJsLoader._load;
  commonJsLoader._load = function load(request, parent, isMain) {
    if (request === 'vscode') {
      return vscodeApi;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(extensionPath) as ExtensionModule;
  } finally {
    commonJsLoader._load = originalLoad;
  }
}

export function activateExtension(extension: ExtensionModule): void {
  extension.activate({ subscriptions: [] });
}

// Silences the boundary's Extension Host logging, which would otherwise print stacks on a passing run
export function silenceConsoleErrors(t: TestContext): void {
  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalConsoleError;
  });
}
