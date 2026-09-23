import * as path from 'node:path';
import * as vscode from 'vscode';
import { readOptions } from './configuration';
import { describeError, endSentence, runExportStep } from './exportErrors';
import type { DiagnosticEntry, ExportOptions } from './model';
import { isKnownSeverity } from './severity';
import { buildMarkdown } from './markdown/renderMarkdown';
import {
  getSafeDialogFileName,
  resolveSafeWorkspaceTarget,
  selectWorkspaceFileTarget,
  writeFileToSafeWorkspaceTarget,
} from './output/workspacePathSecurity';

type OutputTarget =
  | {
      kind: 'automatic';
      workspacePath: string;
      configuredPath: string;
      fallbackUri: vscode.Uri;
    }
  | { kind: 'selected'; uri: vscode.Uri };

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
