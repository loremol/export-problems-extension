import * as vscode from 'vscode';
import { exportProblemsToMarkdown } from './exportProblemsToMarkdown';

export function activate(
  context: Pick<vscode.ExtensionContext, 'subscriptions'>
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('export-problems.export', exportProblemsToMarkdown)
  );
}

export function deactivate(): void { }
