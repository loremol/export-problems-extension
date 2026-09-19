import * as vscode from 'vscode';
import { formatExportFailure } from './exportErrors';
import { exportProblemsToMarkdown } from './exportProblemsToMarkdown';

// Runs the export, reporting a failure rather than leaving VS Code to report a failed command
async function runExportCommand(): Promise<void> {
  try {
    await exportProblemsToMarkdown();
  } catch (error) {
    // The notification carries one line, so the raw error keeps the stack in the Extension Host log.
    console.error('Export Problems to Markdown failed', error);
    vscode.window.showErrorMessage(formatExportFailure(error));
  }
}

// Registers the export command with the extension host.
export function activate(
  context: Pick<vscode.ExtensionContext, 'subscriptions'>
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('export-problems.export', runExportCommand)
  );
}

// Provides the extension host's optional deactivation hook.
export function deactivate(): void { }
