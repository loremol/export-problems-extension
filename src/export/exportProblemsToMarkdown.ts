import * as vscode from 'vscode';
import { readOptions } from './configuration';
import { describeError, endSentence, runExportStep } from './exportErrors';
import type { ExportOptions } from './model';
import { buildMarkdown } from './markdown/renderMarkdown';
import {
  collectAllDiagnosticEntries,
  collectFilteredDiagnosticEntries,
  findHiddenDiagnosticEntries,
  formatHiddenDiagnosticsNotice,
  hasMultipleWorkspaceFolders,
  resolveExportTargetPaths,
} from './diagnostics';
import {
  getSafeDialogFileName,
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
