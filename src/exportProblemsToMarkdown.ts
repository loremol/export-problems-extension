import * as vscode from 'vscode';
import { selectWorkspaceFileTarget } from './workspacePathSecurity';

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
  summaryTitle: string;
  includeExportDate: boolean;
  includeProblemCount: boolean;
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
    summaryTitle: config.get<string>('summaryTitle', 'Problems'),
    includeExportDate: config.get<boolean>('includeExportDate', false),
    includeProblemCount: config.get<boolean>('includeProblemCount', false),
    includeSource: config.get<boolean>('includeSource', true),
    includeColumn: config.get<boolean>('includeColumn', true),
    defaultFileName: config.get<string>('defaultFileName', 'problems-export.md'),
    outputMode: config.get<ExportOptions['outputMode']>('outputMode', 'save-dialog'),
    openAfterExport: config.get<boolean>('openAfterExport', true),
  };
}

// True if there is more than one workspace open in the same window
function hasMultipleWorkspaceFolders(): boolean {
  // No workspace has been opened
  if (vscode.workspace.workspaceFolders == undefined) {
    return false;
  }

  if (vscode.workspace.workspaceFolders.length > 1) {
    return true;
  } else {
    return false;
  }
}

export async function exportProblemsToMarkdown(): Promise<void> {
  const options = readOptions();

  const includeFolderName = hasMultipleWorkspaceFolders();

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
    const target = await selectWorkspaceFileTarget(
      workspaceFolder.uri.scheme,
      workspaceFolder.uri.fsPath,
      options.defaultFileName
    );
    if (target.kind === 'automatic') {
      targetUri = vscode.Uri.file(target.targetPath);
    } else {
      targetUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(workspaceFolder.uri, target.fileName),
        filters: { Markdown: ['md'] },
        saveLabel: 'Export Problems',
      });
      if (!targetUri) {
        return;
      }
    }
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
    lines.push(`# ${formatInlineText(options.summaryTitle)}`, '');
    if (options.includeExportDate) {
      lines.push(`Generated: ${new Date().toISOString()}`);
    }
    if (options.includeProblemCount) {
      const totalCount = entries.reduce((sum, [, diagnostics]) => sum + diagnostics.length, 0);
      lines.push(`Total problems: ${totalCount} across ${entries.length} file(s)`);
    }
    if (options.includeExportDate || options.includeProblemCount) {
      lines.push('');
    }
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

function formatGroupHeading(title: string, includeSummary: boolean): string {
  return `${includeSummary ? '##' : '#'} ${title}`;
}

function buildByFile(
  entries: [vscode.Uri, vscode.Diagnostic[]][],
  includeFolderName: boolean,
  options: ExportOptions
): string[] {
  const lines: string[] = [];
  for (const [uri, diagnostics] of entries) {
    const path = formatInlineText(vscode.workspace.asRelativePath(uri, includeFolderName));
    lines.push(formatGroupHeading(path, options.includeSummary), '');
    for (const diagnostic of diagnostics) {
      const loc = formatLocation(diagnostic, options.includeColumn);
      const label = severityLabels[diagnostic.severity];
      const tag = formatSourceTag(diagnostic, options.includeSource);
      lines.push(`- **Line ${loc}** ${label}${tag}: ${formatInlineText(diagnostic.message)}`);
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
    lines.push(formatGroupHeading(severityHeadings[severity], options.includeSummary), '');
    for (const { path, diagnostic } of items) {
      const loc = formatLocation(diagnostic, options.includeColumn);
      const tag = formatSourceTag(diagnostic, options.includeSource);
      lines.push(
        `- **${formatInlineText(path)}:${loc}**${tag}: ${formatInlineText(diagnostic.message)}`
      );
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
    const path = formatTableCell(vscode.workspace.asRelativePath(uri, includeFolderName));
    for (const diagnostic of diagnostics) {
      const cells = [
        severityLabels[diagnostic.severity],
        path,
        formatLocation(diagnostic, options.includeColumn),
      ];
      if (options.includeSource) {
        cells.push(formatSourceAndCode(diagnostic, formatTableCell));
      }
      cells.push(formatTableCell(diagnostic.message));
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

function formatSourceAndCode(
  diagnostic: vscode.Diagnostic,
  escapeText: (value: string) => string
): string {
  const parts: string[] = [];
  if (diagnostic.source) {
    parts.push(escapeText(diagnostic.source));
  }
  const code = formatCode(diagnostic.code);
  if (code) {
    parts.push(escapeText(code));
  }
  return parts.join(', ');
}

function formatSourceTag(diagnostic: vscode.Diagnostic, includeSource: boolean): string {
  if (!includeSource) {
    return '';
  }
  const sourceAndCode = formatSourceAndCode(diagnostic, formatInlineText);
  return sourceAndCode ? ` [${sourceAndCode}]` : '';
}

function formatInlineText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

function formatTableCell(value: string): string {
  return formatInlineText(value).replace(/\|/g, '\\|');
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
