import * as path from 'node:path';
import * as vscode from 'vscode';
import { describeError, endSentence, runExportStep } from './exportErrors';
import {
  getSafeDialogFileName,
  resolveSafeWorkspaceTarget,
  selectWorkspaceFileTarget,
  writeFileToSafeWorkspaceTarget,
} from './workspacePathSecurity';

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

// TypeScript erases enum constraints at runtime. Diagnostics from other extensions can therefore
// carry a severity outside the four declared values.
const unknownSeverityLabel = 'Unknown severity';
const unknownSeverityHeading = 'Unknown severities';

// Check whether VS Code declares this severity.
function isKnownSeverity(severity: vscode.DiagnosticSeverity): boolean {
  return severityOrder.includes(severity);
}

// Use a shared fallback label for severities outside the declared range.
function formatSeverityLabel(severity: vscode.DiagnosticSeverity): string {
  return isKnownSeverity(severity) ? severityLabels[severity] : unknownSeverityLabel;
}

// Put known severity sections first and collect unrecognized values in the last section.
const severitySections: ReadonlyArray<{
  heading: string;
  includesSeverity: (severity: vscode.DiagnosticSeverity) => boolean;
}> = [
  ...severityOrder.map((sectionSeverity) => ({
    heading: severityHeadings[sectionSeverity],
    includesSeverity: (severity: vscode.DiagnosticSeverity) => severity === sectionSeverity,
  })),
  {
    heading: unknownSeverityHeading,
    includesSeverity: (severity: vscode.DiagnosticSeverity) => !isKnownSeverity(severity),
  },
];

const severityThresholds: Record<string, vscode.DiagnosticSeverity> = {
  Error: vscode.DiagnosticSeverity.Error,
  Warning: vscode.DiagnosticSeverity.Warning,
  Information: vscode.DiagnosticSeverity.Information,
  Hint: vscode.DiagnosticSeverity.Hint,
};

// Look up configured severity names without reading inherited properties.
function readSeverityThreshold(severityName: string): vscode.DiagnosticSeverity {
  return Object.hasOwn(severityThresholds, severityName)
    ? severityThresholds[severityName]
    : vscode.DiagnosticSeverity.Hint;
}

type DiagnosticEntry = [vscode.Uri, vscode.Diagnostic[]];

interface ExportOptions {
  threshold: vscode.DiagnosticSeverity;
  minimumSeverityName: string;
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

type OutputTarget =
  | {
      kind: 'automatic';
      workspacePath: string;
      configuredPath: string;
      fallbackUri: vscode.Uri;
    }
  | { kind: 'selected'; uri: vscode.Uri };

// Read a string setting, or use its default when the stored value has another type.
function readStringSetting<T extends string>(
  config: vscode.WorkspaceConfiguration,
  section: string,
  defaultValue: T
): T {
  // VS Code stores settings verbatim, so a declared "string" can still read back as any JSON value.
  const value = config.get<unknown>(section, defaultValue);
  return typeof value === 'string' ? (value as T) : defaultValue;
}

// Load the export options from the workspace configuration.
function readOptions(): ExportOptions {
  const config = vscode.workspace.getConfiguration('exportProblems');
  const minimumSeverityName = readStringSetting(config, 'minimumSeverity', 'Hint');
  const threshold = readSeverityThreshold(minimumSeverityName);
  return {
    threshold,
    minimumSeverityName: severityLabels[threshold],
    groupBy: readStringSetting<ExportOptions['groupBy']>(config, 'groupBy', 'file'),
    includeSummary: config.get<boolean>('includeSummary', true),
    summaryTitle: readStringSetting(config, 'summaryTitle', 'Problems'),
    includeExportDate: config.get<boolean>('includeExportDate', false),
    includeProblemCount: config.get<boolean>('includeProblemCount', false),
    includeSource: config.get<boolean>('includeSource', true),
    includeColumn: config.get<boolean>('includeColumn', true),
    defaultFileName: readStringSetting(config, 'defaultFileName', 'problems.md'),
    outputMode: readStringSetting<ExportOptions['outputMode']>(config, 'outputMode', 'save-dialog'),
    openAfterExport: config.get<boolean>('openAfterExport', true),
  };
}

// Relative paths need folder names when the window contains multiple workspaces.
function hasMultipleWorkspaceFolders(): boolean {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
}

// Resolve both target paths because a symlinked workspace has different lexical and canonical roots.
async function resolveExportTargetPaths(options: ExportOptions): Promise<string[]> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder || workspaceFolder.uri.scheme !== 'file') {
    return [];
  }

  const lexicalPath = path.resolve(workspaceFolder.uri.fsPath, options.defaultFileName);
  const canonicalPath = await resolveSafeWorkspaceTarget(
    workspaceFolder.uri.fsPath,
    options.defaultFileName
  );

  return canonicalPath !== undefined && canonicalPath !== lexicalPath
    ? [lexicalPath, canonicalPath]
    : [lexicalPath];
}

// Check whether a diagnostic belongs to the export file itself.
function isExportTargetUri(
  uri: vscode.Uri,
  exportTargetPaths: readonly string[]
): boolean {
  return (
    uri.scheme === 'file' &&
    exportTargetPaths.some((exportTargetPath) => path.resolve(uri.fsPath) === exportTargetPath)
  );
}

// Keep diagnostics at the configured threshold and sort them by path and position.
function collectFilteredDiagnosticEntries(
  threshold: vscode.DiagnosticSeverity,
  includeWorkspaceFolderName: boolean,
  exportTargetPaths: readonly string[]
): DiagnosticEntry[] {
  return vscode.languages
    .getDiagnostics()
    .filter(([uri]) => !isExportTargetUri(uri, exportTargetPaths))
    .map(([uri, diagnostics]): DiagnosticEntry => [
      uri,
      diagnostics
        // Unknown severities have no meaningful threshold order, so keep all of them.
        .filter(
          (diagnostic) =>
            !isKnownSeverity(diagnostic.severity) || diagnostic.severity <= threshold
        )
        .sort(
          (left, right) =>
            left.range.start.line - right.range.start.line ||
            left.range.start.character - right.range.start.character
        ),
    ])
    .filter(([, diagnostics]) => diagnostics.length > 0)
    .sort((left, right) => {
      const leftPath = vscode.workspace.asRelativePath(left[0], includeWorkspaceFolderName);
      const rightPath = vscode.workspace.asRelativePath(right[0], includeWorkspaceFolderName);
      return leftPath.localeCompare(rightPath);
    });
}

// Collect every workspace diagnostic regardless of the configured threshold.
function collectAllDiagnosticEntries(
  includeWorkspaceFolderName: boolean,
  exportTargetPaths: readonly string[]
): DiagnosticEntry[] {
  return collectFilteredDiagnosticEntries(
    vscode.DiagnosticSeverity.Hint,
    includeWorkspaceFolderName,
    exportTargetPaths
  );
}

// Find diagnostics removed by the threshold. The identity comparison requires both lists from the same tick.
function findHiddenDiagnosticEntries(
  allEntries: DiagnosticEntry[],
  filteredEntries: DiagnosticEntry[]
): DiagnosticEntry[] {
  const includedDiagnostics = new Set<vscode.Diagnostic>();
  for (const [, diagnostics] of filteredEntries) {
    for (const diagnostic of diagnostics) {
      includedDiagnostics.add(diagnostic);
    }
  }

  return allEntries
    .map(([uri, diagnostics]): DiagnosticEntry => [
      uri,
      diagnostics.filter((diagnostic) => !includedDiagnostics.has(diagnostic)),
    ])
    .filter(([, diagnostics]) => diagnostics.length > 0);
}

// Use the singular form only when the count is one.
function pluralize(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

// Describe diagnostics hidden by the threshold, or return nothing for a complete export.
function formatHiddenDiagnosticsNotice(
  hiddenEntries: DiagnosticEntry[],
  minimumSeverityName: string
): string {
  const hiddenCount = hiddenEntries.reduce(
    (sum, [, diagnostics]) => sum + diagnostics.length,
    0
  );
  if (hiddenCount === 0) {
    return '';
  }

  const fileCount = hiddenEntries.length;
  return (
    `${hiddenCount} ${pluralize(hiddenCount, 'problem')} in `
    + `${fileCount} ${pluralize(fileCount, 'file')} `
    + `${hiddenCount === 1 ? 'was' : 'were'} excluded by `
    + `exportProblems.minimumSeverity (${minimumSeverityName}). `
    + "The Problems panel's own filter box is not applied to exports."
  );
}

// Export the current workspace diagnostics as Markdown.
export async function exportProblemsToMarkdown(): Promise<void> {
  const options = readOptions();
  const includeWorkspaceFolderName = hasMultipleWorkspaceFolders();
  const exportTargetPaths = await resolveExportTargetPaths(options);
  // Keep these calls adjacent and synchronous. findHiddenDiagnosticEntries compares object
  // identities, which are stable only within the same tick.
  const entries = collectFilteredDiagnosticEntries(
    options.threshold,
    includeWorkspaceFolderName,
    exportTargetPaths
  );
  const hiddenEntries = findHiddenDiagnosticEntries(
    collectAllDiagnosticEntries(includeWorkspaceFolderName, exportTargetPaths),
    entries
  );
  const hiddenNotice = formatHiddenDiagnosticsNotice(
    hiddenEntries,
    options.minimumSeverityName
  );

  if (entries.length === 0) {
    vscode.window.showInformationMessage(
      hiddenNotice
        ? `No problems at or above severity ${options.minimumSeverityName}. ${hiddenNotice}`
        : 'No problems found in workspace.'
    );
    return;
  }

  const content = buildMarkdown(entries, includeWorkspaceFolderName, options);
  await deliverMarkdown(content, options, hiddenNotice);
}

// Send the generated Markdown to the configured destination.
async function deliverMarkdown(
  content: string,
  options: ExportOptions,
  hiddenNotice: string
): Promise<void> {
  if (options.outputMode === 'clipboard') {
    await runExportStep('copy the export to the clipboard', () =>
      vscode.env.clipboard.writeText(content)
    );
    vscode.window.showInformationMessage(
      appendHiddenNotice('Problems exported to clipboard.', hiddenNotice)
    );
    return;
  }

  const target = await selectOutputTarget(options);
  if (!target) {
    return;
  }

  if (target.kind === 'selected') {
    await writeMarkdownFile(target.uri, content, options.openAfterExport, hiddenNotice);
    return;
  }

  const writtenPath = await runExportStep(
    `write the export to ${target.configuredPath}`,
    () =>
      writeFileToSafeWorkspaceTarget(
        target.workspacePath,
        target.configuredPath,
        Buffer.from(content, 'utf8')
      )
  );
  if (writtenPath) {
    await completeMarkdownFileExport(
      vscode.Uri.file(writtenPath),
      options.openAfterExport,
      hiddenNotice
    );
    return;
  }

  const fallbackUri = await showMarkdownSaveDialog(target.fallbackUri);
  if (fallbackUri) {
    await writeMarkdownFile(fallbackUri, content, options.openAfterExport, hiddenNotice);
  }
}

// Choose between automatic workspace output and a user-selected destination.
async function selectOutputTarget(options: ExportOptions): Promise<OutputTarget | undefined> {
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
      return {
        kind: 'automatic',
        workspacePath: workspaceFolder.uri.fsPath,
        configuredPath: options.defaultFileName,
        fallbackUri: vscode.Uri.joinPath(
          workspaceFolder.uri,
          getSafeDialogFileName(options.defaultFileName)
        ),
      };
    }

    const selectedUri = await showMarkdownSaveDialog(
      vscode.Uri.joinPath(workspaceFolder.uri, target.fileName)
    );
    return selectedUri ? { kind: 'selected', uri: selectedUri } : undefined;
  }

  const defaultUri = workspaceFolder
    ? vscode.Uri.joinPath(workspaceFolder.uri, getSafeDialogFileName(options.defaultFileName))
    : undefined;
  const selectedUri = await showMarkdownSaveDialog(defaultUri);
  return selectedUri ? { kind: 'selected', uri: selectedUri } : undefined;
}

// Open the save dialog for a Markdown export.
function showMarkdownSaveDialog(
  defaultUri?: vscode.Uri
): Promise<vscode.Uri | undefined> {
  return runExportStep('open the save dialog', () =>
    vscode.window.showSaveDialog({
      defaultUri,
      filters: { Markdown: ['md'] },
      saveLabel: 'Export Problems',
    })
  );
}

// Append the hidden-diagnostics notice when there is one.
function appendHiddenNotice(message: string, hiddenNotice: string): string {
  return hiddenNotice ? `${message} ${hiddenNotice}` : message;
}

// Write Markdown to the URI selected by the user.
async function writeMarkdownFile(
  targetUri: vscode.Uri,
  content: string,
  openAfterExport: boolean,
  hiddenNotice: string
): Promise<void> {
  await runExportStep(
    `write the export to ${vscode.workspace.asRelativePath(targetUri)}`,
    () => vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, 'utf8'))
  );
  await completeMarkdownFileExport(targetUri, openAfterExport, hiddenNotice);
}

// Open a written export and return a notice if VS Code cannot show it.
async function tryOpenExport(targetUri: vscode.Uri): Promise<string> {
  try {
    const document = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(document);
    return '';
  } catch (error) {
    // The report is already on disk, so failing to open it does not fail the export.
    console.error('The exported file could not be opened', error);
    return endSentence(`The exported file could not be opened: ${describeError(error)}`);
  }
}

// Open the file when requested, then report the completed export.
async function completeMarkdownFileExport(
  targetUri: vscode.Uri,
  openAfterExport: boolean,
  hiddenNotice: string
): Promise<void> {
  const openNotice = openAfterExport ? await tryOpenExport(targetUri) : '';
  const message = appendHiddenNotice(
    `Problems exported to ${vscode.workspace.asRelativePath(targetUri)}.`,
    hiddenNotice
  );

  if (openNotice) {
    vscode.window.showWarningMessage(`${message} ${openNotice}`);
    return;
  }

  vscode.window.showInformationMessage(message);
}

// Build the complete Markdown document with the selected grouping.
function buildMarkdown(
  entries: DiagnosticEntry[],
  includeWorkspaceFolderName: boolean,
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
      lines.push(...buildBySeverity(entries, includeWorkspaceFolderName, options));
      break;
    case 'flat-table':
      lines.push(...buildFlatTable(entries, includeWorkspaceFolderName, options));
      break;
    case 'file':
    default:
      lines.push(...buildByFile(entries, includeWorkspaceFolderName, options));
      break;
  }

  return lines.join('\n');
}

// Use a second-level heading when the document already has a summary title.
function formatGroupHeading(title: string, includeSummary: boolean): string {
  return `${includeSummary ? '##' : '#'} ${title}`;
}

// Build sections grouped by file.
function buildByFile(
  entries: DiagnosticEntry[],
  includeWorkspaceFolderName: boolean,
  options: ExportOptions
): string[] {
  const lines: string[] = [];
  for (const [uri, diagnostics] of entries) {
    const path = formatInlineText(vscode.workspace.asRelativePath(uri, includeWorkspaceFolderName));
    lines.push(formatGroupHeading(path, options.includeSummary), '');
    for (const diagnostic of diagnostics) {
      const loc = formatLocation(diagnostic, options.includeColumn);
      const label = formatSeverityLabel(diagnostic.severity);
      const tag = formatSourceTag(diagnostic, options.includeSource);
      const message = formatInlineText(toText(diagnostic.message));
      lines.push(`- **Line ${loc}** ${label}${tag}: ${message}`);
    }
    lines.push('');
  }
  return lines;
}

// Build sections grouped by severity.
function buildBySeverity(
  entries: DiagnosticEntry[],
  includeWorkspaceFolderName: boolean,
  options: ExportOptions
): string[] {
  const lines: string[] = [];
  for (const { heading, includesSeverity } of severitySections) {
    const items: { path: string; diagnostic: vscode.Diagnostic }[] = [];
    for (const [uri, diagnostics] of entries) {
      const path = vscode.workspace.asRelativePath(uri, includeWorkspaceFolderName);
      for (const diagnostic of diagnostics) {
        if (includesSeverity(diagnostic.severity)) {
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
    lines.push(formatGroupHeading(heading, options.includeSummary), '');
    for (const { path, diagnostic } of items) {
      const loc = formatLocation(diagnostic, options.includeColumn);
      const tag = formatSourceTag(diagnostic, options.includeSource);
      const message = formatInlineText(toText(diagnostic.message));
      lines.push(`- **${formatInlineText(path)}:${loc}**${tag}: ${message}`);
    }
    lines.push('');
  }
  return lines;
}

// Build one Markdown table containing every diagnostic.
function buildFlatTable(
  entries: DiagnosticEntry[],
  includeWorkspaceFolderName: boolean,
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
    const path = formatTableCell(vscode.workspace.asRelativePath(uri, includeWorkspaceFolderName));
    for (const diagnostic of diagnostics) {
      const cells = [
        formatSeverityLabel(diagnostic.severity),
        path,
        formatLocation(diagnostic, options.includeColumn),
      ];
      if (options.includeSource) {
        cells.push(formatSourceAndCode(diagnostic, formatTableCell));
      }
      cells.push(formatTableCell(toText(diagnostic.message)));
      lines.push(`| ${cells.join(' | ')} |`);
    }
  }

  lines.push('');
  return lines;
}

// Format the one-based line number and optional column.
function formatLocation(diagnostic: vscode.Diagnostic, includeColumn: boolean): string {
  const line = diagnostic.range.start.line + 1;
  if (!includeColumn) {
    return `${line}`;
  }
  const column = diagnostic.range.start.character + 1;
  return `${line}:${column}`;
}

// Format whichever source and code fields the diagnostic provides.
function formatSourceAndCode(
  diagnostic: vscode.Diagnostic,
  escapeText: (value: string) => string
): string {
  const parts: string[] = [];
  if (diagnostic.source) {
    parts.push(escapeText(toText(diagnostic.source)));
  }
  const code = formatCode(diagnostic.code);
  if (code) {
    parts.push(escapeText(code));
  }
  return parts.join(', ');
}

// Format the diagnostic source and code as an inline tag.
function formatSourceTag(diagnostic: vscode.Diagnostic, includeSource: boolean): string {
  if (!includeSource) {
    return '';
  }
  const sourceAndCode = formatSourceAndCode(diagnostic, formatInlineText);
  return sourceAndCode ? ` [${sourceAndCode}]` : '';
}

// Collapse line breaks before inserting text into inline Markdown.
function formatInlineText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

// Escape text for use in a Markdown table cell.
function formatTableCell(value: string): string {
  return formatInlineText(value).replace(
    /(\\*)\|/g,
    (_match, backslashes: string) => `${backslashes.repeat(2)}\\|`
  );
}

// Normalize diagnostic text because other extensions can supply values with the wrong type.
function toText(value: unknown): string {
  return String(value);
}

// Normalize a diagnostic code to text, including null from untyped providers.
function formatCode(code: vscode.Diagnostic['code'] | null): string {
  if (code === undefined || code === null) {
    return '';
  }
  if (typeof code === 'object') {
    return String(code.value);
  }
  return String(code);
}
