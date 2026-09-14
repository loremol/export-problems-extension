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

type DiagnosticEntry = [vscode.Uri, vscode.Diagnostic[]];

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

// Reads the configured export options
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

// Returns true if there is more than one workspace open in the same window
function shouldIncludeWorkspaceFolderName(): boolean {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
}

// Collects matching diagnostics in stable path and position order
function collectDiagnosticEntries(
  threshold: vscode.DiagnosticSeverity,
  includeFolderName: boolean
): DiagnosticEntry[] {
  return vscode.languages
    .getDiagnostics()
    .map(([uri, diagnostics]): DiagnosticEntry => [
      uri,
      diagnostics
        .filter((diagnostic) => diagnostic.severity <= threshold)
        .sort(
          (left, right) =>
            left.range.start.line - right.range.start.line ||
            left.range.start.character - right.range.start.character
        ),
    ])
    .filter(([, diagnostics]) => diagnostics.length > 0)
    .sort((left, right) => {
      const leftPath = vscode.workspace.asRelativePath(left[0], includeFolderName);
      const rightPath = vscode.workspace.asRelativePath(right[0], includeFolderName);
      return leftPath.localeCompare(rightPath);
    });
}

// Exports the current workspace diagnostics as Markdown
export async function exportProblemsToMarkdown(): Promise<void> {
  const options = readOptions();
  const includeFolderName = shouldIncludeWorkspaceFolderName();
  const entries = collectDiagnosticEntries(options.threshold, includeFolderName);

  if (entries.length === 0) {
    vscode.window.showInformationMessage('No problems found in workspace.');
    return;
  }

  const content = buildMarkdown(entries, includeFolderName, options);
  await deliverMarkdown(content, options);
}

// Sends generated Markdown to the configured destination
async function deliverMarkdown(content: string, options: ExportOptions): Promise<void> {
  if (options.outputMode === 'clipboard') {
    await vscode.env.clipboard.writeText(content);
    vscode.window.showInformationMessage('Problems exported to clipboard.');
    return;
  }

  const targetUri = await selectOutputUri(options);
  if (!targetUri) {
    return;
  }

  await writeMarkdownFile(targetUri, content, options.openAfterExport);
}

// Resolves the output URI for the configured file destination
async function selectOutputUri(options: ExportOptions): Promise<vscode.Uri | undefined> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (options.outputMode === 'workspace-file') {
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(
        "Cannot use the 'workspace-file' output mode: no workspace folder is open."
      );
      return undefined;
    }

    const target = await selectWorkspaceFileTarget(
      workspaceFolder.uri.scheme,
      workspaceFolder.uri.fsPath,
      options.defaultFileName
    );
    if (target.kind === 'automatic') {
      return vscode.Uri.file(target.targetPath);
    }

    return showMarkdownSaveDialog(
      vscode.Uri.joinPath(workspaceFolder.uri, target.fileName)
    );
  }

  const defaultUri = workspaceFolder
    ? vscode.Uri.joinPath(workspaceFolder.uri, options.defaultFileName)
    : undefined;
  return showMarkdownSaveDialog(defaultUri);
}

// Opens the Markdown export save dialog
function showMarkdownSaveDialog(
  defaultUri?: vscode.Uri
): Thenable<vscode.Uri | undefined> {
  return vscode.window.showSaveDialog({
    defaultUri,
    filters: { Markdown: ['md'] },
    saveLabel: 'Export Problems',
  });
}

// Writes Markdown and reports or opens the exported file
async function writeMarkdownFile(
  targetUri: vscode.Uri,
  content: string,
  openAfterExport: boolean
): Promise<void> {
  await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, 'utf8'));

  if (openAfterExport) {
    const document = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(document);
    return;
  }

  vscode.window.showInformationMessage(
    `Problems exported to ${vscode.workspace.asRelativePath(targetUri)}.`
  );
}

// Builds the complete Markdown export by choosing the right strategy based on options
function buildMarkdown(
  entries: DiagnosticEntry[],
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

// Formats a group heading at the appropriate document level
function formatGroupHeading(title: string, includeSummary: boolean): string {
  return `${includeSummary ? '##' : '#'} ${title}`;
}

// Builds Markdown grouped by file
function buildByFile(
  entries: DiagnosticEntry[],
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

// Builds Markdown grouped by severity
function buildBySeverity(
  entries: DiagnosticEntry[],
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

// Builds diagnostics as a single Markdown table
function buildFlatTable(
  entries: DiagnosticEntry[],
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

// Formats a diagnostic's one-based line and optional column
function formatLocation(diagnostic: vscode.Diagnostic, includeColumn: boolean): string {
  const line = diagnostic.range.start.line + 1;
  if (!includeColumn) {
    return `${line}`;
  }
  const column = diagnostic.range.start.character + 1;
  return `${line}:${column}`;
}

// Formats a diagnostic's available source and code
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

// Formats a diagnostic source and code as an inline tag
function formatSourceTag(diagnostic: vscode.Diagnostic, includeSource: boolean): string {
  if (!includeSource) {
    return '';
  }
  const sourceAndCode = formatSourceAndCode(diagnostic, formatInlineText);
  return sourceAndCode ? ` [${sourceAndCode}]` : '';
}

// Collapses line breaks for inline Markdown output
function formatInlineText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

// Formats text for use in a Markdown table cell
function formatTableCell(value: string): string {
  return formatInlineText(value).replace(
    /(\\*)\|/g,
    (_match, backslashes: string) => `${backslashes.repeat(2)}\\|`
  );
}

// Normalizes a diagnostic code to text
function formatCode(code: vscode.Diagnostic['code']): string {
  if (code === undefined) {
    return '';
  }
  if (typeof code === 'object') {
    return String(code.value);
  }
  return String(code);
}
