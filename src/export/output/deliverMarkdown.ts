import * as vscode from 'vscode';
import { describeError, endSentence, runExportStep } from '../exportErrors';
import type { ExportOptions } from '../model';
import { selectOutputTarget, showMarkdownSaveDialog } from './selectOutputTarget';
import { writeFileToSafeWorkspaceTarget } from './workspacePathSecurity';

// Send the generated Markdown to the configured destination.
export async function deliverMarkdown(
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
