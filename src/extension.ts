import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('export-problems.export', exportProblemsToMarkdown)
  );
}

export function deactivate(): void { }

const severityLabels: Record<vscode.DiagnosticSeverity, string> = {
  [vscode.DiagnosticSeverity.Error]: 'Error',
  [vscode.DiagnosticSeverity.Warning]: 'Warning',
  [vscode.DiagnosticSeverity.Information]: 'Information',
  [vscode.DiagnosticSeverity.Hint]: 'Hint',
};

const severityHeadings: Record<vscode.DiagnosticSeverity, string> = {
  [vscode.DiagnosticSeverity.Error]: 'Errors',
  [vscode.DiagnosticSeverity.Warning]: 'Warnings',
  [vscode.DiagnosticSeverity.Information]: 'Information',
  [vscode.DiagnosticSeverity.Hint]: 'Hints',
};

const severityOrder: vscode.DiagnosticSeverity[] = [
  vscode.DiagnosticSeverity.Error,
  vscode.DiagnosticSeverity.Warning,
  vscode.DiagnosticSeverity.Information,
  vscode.DiagnosticSeverity.Hint,
];

const severityThresholds: Record<string, vscode.DiagnosticSeverity> = {
  Error: vscode.DiagnosticSeverity.Error,
  Warning: vscode.DiagnosticSeverity.Warning,
  Information: vscode.DiagnosticSeverity.Information,
  Hint: vscode.DiagnosticSeverity.Hint,
};

interface ExportOptions {
  threshold: vscode.DiagnosticSeverity;
  groupBy: 'file' | 'severity' | 'flat-table';
  includeSummary: boolean;
  includeSource: boolean;
  includeColumn: boolean;
  defaultFileName: string;
  outputMode: 'save-dialog' | 'workspace-file' | 'clipboard';
  openAfterExport: boolean;
}

function readOptions(): ExportOptions {
  const config = vscode.workspace.getConfiguration('exportProblems');
  const minimumSeverityName = config.get<string>('minimumSeverity', 'Hint');
  return {
    threshold: severityThresholds[minimumSeverityName] ?? vscode.DiagnosticSeverity.Hint,
    groupBy: config.get<ExportOptions['groupBy']>('groupBy', 'file'),
    includeSummary: config.get<boolean>('includeSummary', true),
    includeSource: config.get<boolean>('includeSource', true),
    includeColumn: config.get<boolean>('includeColumn', true),
    defaultFileName: config.get<string>('defaultFileName', 'problems-export.md'),
    outputMode: config.get<ExportOptions['outputMode']>('outputMode', 'save-dialog'),
    openAfterExport: config.get<boolean>('openAfterExport', true),
  };
}

async function exportProblemsToMarkdown(): Promise<void> {
  const options = readOptions();
  const includeFolderName = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;

  const entries: [vscode.Uri, vscode.Diagnostic[]][] = vscode.languages
    .getDiagnostics()
    .map(([uri, diagnostics]): [vscode.Uri, vscode.Diagnostic[]] => [
      uri,
      diagnostics
        .filter((d) => d.severity <= options.threshold)
        .slice()
        .sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character),
    ])
    .filter(([, diagnostics]) => diagnostics.length > 0)
    .sort((a, b) =>
      vscode.workspace.asRelativePath(a[0], includeFolderName).localeCompare(vscode.workspace.asRelativePath(b[0], includeFolderName))
    );

  if (entries.length === 0) {
    vscode.window.showInformationMessage('No problems found in workspace.');
    return;
  }

  const content = buildMarkdown(entries, includeFolderName, options);

  if (options.outputMode === 'clipboard') {
    await vscode.env.clipboard.writeText(content);
    vscode.window.showInformationMessage('Problems exported to clipboard.');
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  let targetUri: vscode.Uri | undefined;

  if (options.outputMode === 'workspace-file') {
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(
        "Cannot use the 'workspace-file' output mode: no workspace folder is open."
      );
      return;
    }
    targetUri = vscode.Uri.joinPath(workspaceFolder.uri, options.defaultFileName);
  } else {
    const defaultUri = workspaceFolder
      ? vscode.Uri.joinPath(workspaceFolder.uri, options.defaultFileName)
      : undefined;
    targetUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { Markdown: ['md'] },
      saveLabel: 'Export Problems',
    });
    if (!targetUri) {
      return;
    }
  }

  await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, 'utf8'));

  if (options.openAfterExport) {
    const doc = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(doc);
  } else {
    vscode.window.showInformationMessage(
      `Problems exported to ${vscode.workspace.asRelativePath(targetUri)}.`
    );
  }
}

function buildMarkdown(
  entries: [vscode.Uri, vscode.Diagnostic[]][],
  includeFolderName: boolean,
  options: ExportOptions
): string {
  const lines: string[] = [];

  if (options.includeSummary) {
    const totalCount = entries.reduce((sum, [, diagnostics]) => sum + diagnostics.length, 0);
    lines.push(
      '# Problems Export',
      '',
      `Generated: ${new Date().toISOString()}`,
      `Total problems: ${totalCount} across ${entries.length} file(s)`,
      ''
    );
  }

  switch (options.groupBy) {
    case 'severity':
      lines.push(...buildBySeverity(entries, includeFolderName, options));
      break;
    case 'flat-table':
      lines.push(...buildFlatTable(entries, includeFolderName, options));
      break;
    case 'file':
    default:
      lines.push(...buildByFile(entries, includeFolderName, options));
      break;
  }

  return lines.join('\n');
}

function buildByFile(
  entries: [vscode.Uri, vscode.Diagnostic[]][],
  includeFolderName: boolean,
  options: ExportOptions
): string[] {
  const lines: string[] = [];
  for (const [uri, diagnostics] of entries) {
    lines.push(`## ${vscode.workspace.asRelativePath(uri, includeFolderName)}`, '');
    for (const diagnostic of diagnostics) {
      const loc = formatLocation(diagnostic, options.includeColumn);
      const label = severityLabels[diagnostic.severity];
      const tag = formatSourceTag(diagnostic, options.includeSource);
      lines.push(`- **Line ${loc}** ${label}${tag}: ${flattenMessage(diagnostic.message)}`);
    }
    lines.push('');
  }
  return lines;
}

function buildBySeverity(
  entries: [vscode.Uri, vscode.Diagnostic[]][],
  includeFolderName: boolean,
  options: ExportOptions
): string[] {
  const lines: string[] = [];
  for (const severity of severityOrder) {
    const items: { path: string; diagnostic: vscode.Diagnostic }[] = [];
    for (const [uri, diagnostics] of entries) {
      const path = vscode.workspace.asRelativePath(uri, includeFolderName);
      for (const diagnostic of diagnostics) {
        if (diagnostic.severity === severity) {
          items.push({ path, diagnostic });
        }
      }
    }
    if (items.length === 0) {
      continue;
    }
    items.sort(
      (a, b) =>
        a.path.localeCompare(b.path) ||
        a.diagnostic.range.start.line - b.diagnostic.range.start.line ||
        a.diagnostic.range.start.character - b.diagnostic.range.start.character
    );
    lines.push(`## ${severityHeadings[severity]}`, '');
    for (const { path, diagnostic } of items) {
      const loc = formatLocation(diagnostic, options.includeColumn);
      const tag = formatSourceTag(diagnostic, options.includeSource);
      lines.push(`- **${path}:${loc}**${tag}: ${flattenMessage(diagnostic.message)}`);
    }
    lines.push('');
  }
  return lines;
}

function buildFlatTable(
  entries: [vscode.Uri, vscode.Diagnostic[]][],
  includeFolderName: boolean,
  options: ExportOptions
): string[] {
  const headers = ['Severity', 'File', 'Line'];
  if (options.includeSource) {
    headers.push('Source');
  }
  headers.push('Message');

  const lines: string[] = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];

  for (const [uri, diagnostics] of entries) {
    const path = escapeCell(vscode.workspace.asRelativePath(uri, includeFolderName));
    for (const diagnostic of diagnostics) {
      const cells = [
        severityLabels[diagnostic.severity],
        path,
        formatLocation(diagnostic, options.includeColumn),
      ];
      if (options.includeSource) {
        cells.push(escapeCell(formatSourceAndCode(diagnostic)));
      }
      cells.push(escapeCell(flattenMessage(diagnostic.message)));
      lines.push(`| ${cells.join(' | ')} |`);
    }
  }

  return lines;
}

function formatLocation(diagnostic: vscode.Diagnostic, includeColumn: boolean): string {
  const line = diagnostic.range.start.line + 1;
  if (!includeColumn) {
    return `${line}`;
  }
  const column = diagnostic.range.start.character + 1;
  return `${line}:${column}`;
}

function formatSourceAndCode(diagnostic: vscode.Diagnostic): string {
  const code = formatCode(diagnostic.code);
  return [diagnostic.source, code].filter(Boolean).join(', ');
}

function formatSourceTag(diagnostic: vscode.Diagnostic, includeSource: boolean): string {
  if (!includeSource) {
    return '';
  }
  const sourceAndCode = formatSourceAndCode(diagnostic);
  return sourceAndCode ? ` [${sourceAndCode}]` : '';
}

function flattenMessage(message: string): string {
  return message.replace(/\r?\n/g, ' ');
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function formatCode(code: vscode.Diagnostic['code']): string {
  if (code === undefined) {
    return '';
  }
  if (typeof code === 'object') {
    return String(code.value);
  }
  return String(code);
}
