import * as vscode from 'vscode';
import { formatExportFailure } from './exportErrors';
import { exportProblemsToMarkdown } from './exportProblemsToMarkdown';

// Run the export and report failures instead of leaving VS Code with a rejected command.
async function runExportCommand(): Promise<void> {
  try {
    await exportProblemsToMarkdown();
  } catch (error) {
    // Notifications use one line. Logging the raw error preserves the stack in the Extension Host log.
    console.error('Export Problems to Markdown failed', error);
    vscode.window.showErrorMessage(formatExportFailure(error));
  }
}

// Register the command when VS Code activates the extension.
export function activate(
  context: Pick<vscode.ExtensionContext, 'subscriptions'>
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('export-problems.export', runExportCommand)
  );
}

// VS Code calls this optional hook when deactivating the extension.
export function deactivate(): void { }
