import assert from 'node:assert/strict';
import fsPromises = require('node:fs/promises');
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
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
  diagnosticEntries?: [vscode.Uri, vscode.Diagnostic[]][];
  relativePath?: string;
};

type Write = { uri: vscode.Uri; content: Uint8Array };

type TestHost = {
  vscode: VscodeApi;
  writes: Write[];
  saveDialogs: vscode.SaveDialogOptions[];
  errorMessages: string[];
  informationMessages: string[];
  openedDocuments: vscode.Uri[];
  shownDocuments: vscode.Uri[];
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
  const errorMessages: string[] = [];
  const informationMessages: string[] = [];
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
        return undefined;
      },
      async showErrorMessage(message) {
        errorMessages.push(message);
        return undefined;
      },
      async showInformationMessage(message) {
        informationMessages.push(message);
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
        const relativePath = overrides.relativePath ?? path.relative(workspaceRoot, uri.fsPath);
        return includeWorkspaceFolder
          ? path.join(path.basename(workspaceRoot), relativePath)
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

type ExtensionModule = typeof import('../src/extension');
type CommonJsLoader = {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
};

function loadExtension(vscodeApi: VscodeApi): ExtensionModule {
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

function activateExtension(extension: ExtensionModule): void {
  extension.activate({ subscriptions: [] });
}

test('includes workspace folder names in paths when multiple folders are open', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-multiple-workspaces');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: { outputMode: 'clipboard' },
  });
  host.vscode.workspace.workspaceFolders = [
    ...host.vscode.workspace.workspaceFolders!,
    {
      uri: TestUri.file(path.join(tmpdir(), 'second-workspace')),
      name: 'second-workspace',
      index: 1,
    },
  ];
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  const expectedPath = path.join('export-problems-multiple-workspaces', 'source.ts');
  assert.ok(host.getClipboardText()?.includes(`## ${expectedPath}`));
});

test('reports when no diagnostics meet the configured severity threshold', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-no-matches');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: {
      minimumSeverity: 'Error',
      outputMode: 'clipboard',
    },
    diagnostics: [{
      severity: 1,
      range: createRange(),
      message: 'Filtered warning',
    }],
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.deepEqual(host.informationMessages, ['No problems found in workspace.']);
  assert.equal(host.getClipboardText(), undefined);
  assert.equal(host.writes.length, 0);
  assert.equal(host.saveDialogs.length, 0);
});

test('filters diagnostics by severity and sorts files and positions', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-sorted');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: {
      minimumSeverity: 'Warning',
      includeSummary: false,
      includeSource: false,
      outputMode: 'clipboard',
    },
    diagnosticEntries: [
      [TestUri.file(path.join(workspaceRoot, 'z.ts')), [{
        severity: 1,
        range: createRange(0, 0),
        message: 'Z file warning',
      }]],
      [TestUri.file(path.join(workspaceRoot, 'a.ts')), [
        {
          severity: 1,
          range: createRange(4, 3),
          message: 'Later warning',
        },
        {
          severity: 0,
          range: createRange(1, 7),
          message: 'Later-column error',
        },
        {
          severity: 3,
          range: createRange(0, 0),
          message: 'Filtered hint',
        },
        {
          severity: 1,
          range: createRange(1, 1),
          message: 'Earlier-column warning',
        },
      ]],
    ],
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.equal(
    host.getClipboardText(),
    [
      '# a.ts',
      '',
      '- **Line 2:2** Warning: Earlier-column warning',
      '- **Line 2:8** Error: Later-column error',
      '- **Line 5:4** Warning: Later warning',
      '',
      '# z.ts',
      '',
      '- **Line 1:1** Warning: Z file warning',
      '',
    ].join('\n')
  );
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

test('stops without writing when the save dialog is cancelled', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-cancelled-dialog');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: { outputMode: 'save-dialog' },
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.equal(host.saveDialogs.length, 1);
  assert.equal(host.writes.length, 0);
  assert.equal(host.openedDocuments.length, 0);
});

test('reports an error when workspace-file mode has no open workspace', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-no-workspace');
  const host = createVscode(workspaceRoot, 'problems.md');
  host.vscode.workspace.workspaceFolders = undefined;
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.deepEqual(host.errorMessages, [
    "Cannot use the 'workspace-file' output mode: no workspace folder is open.",
  ]);
  assert.equal(host.saveDialogs.length, 0);
  assert.equal(host.writes.length, 0);
});

test('creates missing parent directories for a workspace-file target', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-write-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const reportsDirectory = path.join(workspaceRoot, 'reports');
  const nestedDirectory = path.join(reportsDirectory, 'nested');
  const targetPath = path.join(nestedDirectory, 'problems.md');
  const host = createVscode(workspaceRoot, path.join('reports', 'nested', 'problems.md'));
  host.vscode.workspace.fs.writeFile = async (uri, content) => {
    await writeFile(uri.fsPath, content);
  };
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.equal(host.saveDialogs.length, 0);
  assert.equal((await stat(reportsDirectory)).isDirectory(), true);
  assert.equal((await stat(nestedDirectory)).isDirectory(), true);
  assert.match(await readFile(targetPath, 'utf8'), /Example problem/);
});

test('overwrites an existing single-link workspace file without prompting', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-overwrite-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const targetPath = path.join(workspaceRoot, 'problems.md');
  await writeFile(targetPath, 'stale export');

  const host = createVscode(workspaceRoot, 'problems.md');
  host.vscode.workspace.fs.writeFile = async (uri, content) => {
    await writeFile(uri.fsPath, content);
  };
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.equal(host.saveDialogs.length, 0);
  assert.equal(
    await readFile(targetPath, 'utf8'),
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

test('does not escape when a validated parent is replaced before writing', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-parent-swap-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const workspaceRoot = path.join(tempRoot, 'workspace');
  const reportsDirectory = path.join(workspaceRoot, 'reports');
  const originalReportsDirectory = path.join(workspaceRoot, 'original-reports');
  const outsideDirectory = path.join(tempRoot, 'outside');
  const outsideFile = path.join(outsideDirectory, 'problems.md');
  await mkdir(reportsDirectory, { recursive: true });
  await mkdir(outsideDirectory);

  let parentReplaced = false;
  const replaceParent = async (): Promise<void> => {
    if (parentReplaced) {
      return;
    }
    parentReplaced = true;
    await rename(reportsDirectory, originalReportsDirectory);
    await symlink(
      outsideDirectory,
      reportsDirectory,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  };

  const realOpen = fsPromises.open;
  t.mock.method(
    fsPromises,
    'open',
    (async (...args: Parameters<typeof fsPromises.open>) => {
      const handle = await realOpen(...args);
      if (process.platform === 'win32') {
        // Windows locks the parent while this handle is open. Reopen the moved
        // file to emulate the descriptor that POSIX keeps valid after rename.
        await handle.close();
        await replaceParent();
        return realOpen(path.join(originalReportsDirectory, 'problems.md'), 'r+');
      }

      await replaceParent();
      return handle;
    }) as typeof fsPromises.open
  );

  const host = createVscode(workspaceRoot, path.join('reports', 'problems.md'));
  host.vscode.workspace.fs.writeFile = async (uri, content) => {
    await replaceParent();
    await writeFile(uri.fsPath, content);
  };
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.equal(parentReplaced, true);
  assert.equal(host.saveDialogs.length, 1);
  assert.equal(await readFile(path.join(originalReportsDirectory, 'problems.md'), 'utf8'), '');
  await assert.rejects(readFile(outsideFile), { code: 'ENOENT' });
});

test('does not overwrite an outside file through an in-workspace hard link', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-hard-link-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const workspaceRoot = path.join(tempRoot, 'workspace');
  const outsideFile = path.join(tempRoot, 'outside.md');
  const sentinel = 'outside sentinel';
  await mkdir(workspaceRoot);
  await writeFile(outsideFile, sentinel);
  await link(outsideFile, path.join(workspaceRoot, 'problems.md'));

  const host = createVscode(workspaceRoot, 'problems.md');
  host.vscode.workspace.fs.writeFile = async (uri, content) => {
    await writeFile(uri.fsPath, content);
  };
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.equal(await readFile(outsideFile, 'utf8'), sentinel);
  assert.equal(host.saveDialogs.length, 1);
});

test('opens the exported workspace file when configured', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-open-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: { openAfterExport: true },
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  const expectedPath = path.join(workspaceRoot, 'problems.md');
  assert.deepEqual(host.openedDocuments.map((uri) => uri.fsPath), [expectedPath]);
  assert.deepEqual(host.shownDocuments.map((uri) => uri.fsPath), [expectedPath]);
  assert.equal(host.informationMessages.length, 0);
});

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

test('keeps a backslash-prefixed pipe inside one Markdown table cell', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-backslash-pipe');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: {
      groupBy: 'flat-table',
      includeSummary: false,
      outputMode: 'clipboard',
    },
    diagnostics: [{
      severity: 0,
      range: createRange(),
      source: 'lint\\|source',
      message: 'message\\|detail',
    }],
    relativePath: 'src/path\\|segment.ts',
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  const tableRow = host.getClipboardText()?.split('\n')[2];
  assert.ok(tableRow);
  const unescapedDelimiterPipes = tableRow.match(/(?<!\\)(?:\\\\)*\|/g) ?? [];
  assert.equal(unescapedDelimiterPipes.length, 6);
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
