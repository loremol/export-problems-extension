import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import Module = require('node:module');
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import type * as vscode from 'vscode';
import { createRange, TestUri } from './vscodeMock';

type ExportConfiguration = {
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

type VscodeApi = {
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

class TestConfiguration implements vscode.WorkspaceConfiguration {
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

type HostOverrides = {
  configuration?: Partial<ExportConfiguration>;
  diagnostics?: vscode.Diagnostic[];
  relativePath?: string;
};

type Write = { uri: vscode.Uri; content: Uint8Array };

type TestHost = {
  vscode: VscodeApi;
  writes: Write[];
  saveDialogs: vscode.SaveDialogOptions[];
  getRegisteredCommand(): () => unknown;
  getClipboardText(): string | undefined;
};

function createVscode(
  workspaceRoot: string,
  configuredPath: string,
  overrides: HostOverrides = {}
): TestHost {
  const writes: Write[] = [];
  const saveDialogs: vscode.SaveDialogOptions[] = [];
  const diagnostics: vscode.Diagnostic[] = overrides.diagnostics ?? [{
    severity: 0,
    range: createRange(),
    message: 'Example problem',
  }];
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
        return [[TestUri.file(path.join(workspaceRoot, 'source.ts')), diagnostics]];
      },
    },
    window: {
      async showSaveDialog(options) {
        saveDialogs.push(options ?? {});
        return undefined;
      },
      async showErrorMessage() {
        return undefined;
      },
      async showInformationMessage() {
        return undefined;
      },
      async showTextDocument(): Promise<vscode.TextEditor> {
        throw new Error('showTextDocument was not expected in this test');
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
      asRelativePath(uri) {
        if (typeof uri === 'string') {
          return uri;
        }
        return overrides.relativePath ?? path.relative(workspaceRoot, uri.fsPath);
      },
      fs: {
        async writeFile(uri, content) {
          writes.push({ uri, content });
        },
      },
      async openTextDocument(): Promise<vscode.TextDocument> {
        throw new Error('openTextDocument was not expected in this test');
      },
    },
  };

  return {
    vscode: vscodeApi,
    writes,
    saveDialogs,
    getRegisteredCommand() {
      assert.ok(registeredCommand, 'extension command was not registered');
      return registeredCommand;
    },
    getClipboardText() {
      return clipboardText;
    },
  };
}

type ExtensionModule = typeof import('../src/extension');
type CommonJsLoader = {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
};

function loadExtension(vscodeApi: VscodeApi): ExtensionModule {
  const extensionPath = require.resolve('../src/extension');
  delete require.cache[extensionPath];

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

function activateExtension(extension: ExtensionModule): void {
  extension.activate({ subscriptions: [] });
}

test('detects when multiple workspace folders are open', () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-multiple-workspaces');
  const host = createVscode(workspaceRoot, 'problems.md');
  host.vscode.workspace.workspaceFolders = [
    ...host.vscode.workspace.workspaceFolders!,
    ...host.vscode.workspace.workspaceFolders!,
  ];
  const extension = loadExtension(host.vscode);

  assert.equal(extension.hasMultipleWorkspaceFolders(), true);
});

test('includes only the summary title by default', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-default-summary');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: { outputMode: 'clipboard' },
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.equal(
    host.getClipboardText(),
    [
      '# Problems',
      '',
      '## source.ts',
      '',
      '- **Line 1:1** Error: Example problem',
      '',
    ].join('\n')
  );
});

test('uses the configured summary title', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-summary-title');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: {
      includeSummary: true,
      summaryTitle: 'Code Quality Report',
      outputMode: 'clipboard',
    },
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.equal(host.getClipboardText()?.split('\n')[0], '# Code Quality Report');
});

test('keeps the configured summary title on one heading line', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-summary-title-line-break');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: {
      includeSummary: true,
      summaryTitle: 'Code\nQuality Report',
      outputMode: 'clipboard',
    },
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.equal(host.getClipboardText()?.split('\n')[0], '# Code Quality Report');
});

test('omits only the export date when includeExportDate is false', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-no-export-date');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: {
      includeSummary: true,
      includeExportDate: false,
      includeProblemCount: true,
      outputMode: 'clipboard',
    },
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  const content = host.getClipboardText();
  assert.ok(!content?.includes('Generated:'));
  assert.ok(content?.includes('Total problems: 1 across 1 file(s)'));
});

test('omits only the problem count when includeProblemCount is false', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-no-problem-count');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: {
      includeSummary: true,
      includeExportDate: true,
      includeProblemCount: false,
      outputMode: 'clipboard',
    },
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  const content = host.getClipboardText();
  assert.ok(content?.includes('Generated:'));
  assert.ok(!content?.includes('Total problems:'));
});

const headingHierarchyCases: ReadonlyArray<{
  name: string;
  configuration: Pick<ExportConfiguration, 'groupBy' | 'includeSummary'>;
  expectedHeadings: string[];
}> = [
  {
    name: 'file grouping without a summary',
    configuration: { groupBy: 'file', includeSummary: false },
    expectedHeadings: ['# source.ts'],
  },
  {
    name: 'severity grouping without a summary',
    configuration: { groupBy: 'severity', includeSummary: false },
    expectedHeadings: ['# Errors'],
  },
  {
    name: 'file grouping with a summary',
    configuration: { groupBy: 'file', includeSummary: true },
    expectedHeadings: ['# Problems', '## source.ts'],
  },
  {
    name: 'severity grouping with a summary',
    configuration: { groupBy: 'severity', includeSummary: true },
    expectedHeadings: ['# Problems', '## Errors'],
  },
];

for (const { name, configuration, expectedHeadings } of headingHierarchyCases) {
  test(`uses a valid heading hierarchy for ${name}`, async () => {
    const workspaceRoot = path.join(tmpdir(), 'export-problems-heading-hierarchy');
    const host = createVscode(workspaceRoot, 'problems.md', {
      configuration: { ...configuration, outputMode: 'clipboard' },
    });
    const extension = loadExtension(host.vscode);
    activateExtension(extension);

    await host.getRegisteredCommand()();

    const headings = host.getClipboardText()
      ?.split('\n')
      .filter((line) => line.startsWith('#'));
    assert.deepEqual(headings, expectedHeadings);
  });
}

test('requires save confirmation instead of writing an escaping workspace target', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const configuredPath = path.join('..', '..', 'outside.md');
  const host = createVscode(workspaceRoot, configuredPath);
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.equal(host.writes.length, 0);
  assert.equal(host.saveDialogs.length, 1);
  assert.equal(
    host.saveDialogs[0].defaultUri?.fsPath,
    path.join(workspaceRoot, 'outside.md')
  );
});

const diagnosticRelativePath = 'src/\n## fake <img>& [path](url) | file.ts';
const diagnosticWithPunctuation: vscode.Diagnostic = {
  severity: 0,
  range: createRange(),
  source: 'lint](url) <b>&',
  code: {
    value: '![code](url)|',
    target: TestUri.file(path.join(tmpdir(), 'diagnostic-code')),
  },
  message: 'first\n- forged <script attr="x" other=\'y\'> **bold** `code` [link](url) ![img](url) | https://evil.test &copy;',
};

const literalPath = 'src/ ## fake <img>& [path](url) | file.ts';
const literalSourceAndCode = 'lint](url) <b>&, ![code](url)|';
const literalMessage = 'first - forged <script attr="x" other=\'y\'> **bold** `code` [link](url) ![img](url) | https://evil.test &copy;';

const literalMarkdownCases: ReadonlyArray<{
  groupBy: ExportConfiguration['groupBy'];
  expected: string;
}> = [
  {
    groupBy: 'file',
    expected: [
      `# ${literalPath}`,
      '',
      `- **Line 1:1** Error [${literalSourceAndCode}]: ${literalMessage}`,
      '',
    ].join('\n'),
  },
  {
    groupBy: 'severity',
    expected: [
      '# Errors',
      '',
      `- **${literalPath}:1:1** [${literalSourceAndCode}]: ${literalMessage}`,
      '',
    ].join('\n'),
  },
  {
    groupBy: 'flat-table',
    expected: [
      '| Severity | File | Line | Source | Message |',
      '| --- | --- | --- | --- | --- |',
      "| Error | src/ ## fake <img>& [path](url) \\| file.ts | 1:1 | lint](url) <b>&, ![code](url)\\| | first - forged <script attr=\"x\" other='y'> **bold** `code` [link](url) ![img](url) \\| https://evil.test &copy; |",
    ].join('\n'),
  },
];

for (const { groupBy, expected } of literalMarkdownCases) {
  test(`emits literal punctuation without breaking ${groupBy} structure`, async () => {
    const workspaceRoot = path.join(tmpdir(), 'export-problems-markdown');
    const host = createVscode(workspaceRoot, 'problems.md', {
      configuration: {
        groupBy,
        includeSummary: false,
        outputMode: 'clipboard',
      },
      diagnostics: [diagnosticWithPunctuation],
      relativePath: diagnosticRelativePath,
    });
    const extension = loadExtension(host.vscode);
    activateExtension(extension);

    await host.getRegisteredCommand()();

    assert.equal(host.getClipboardText(), expected);
  });
}
