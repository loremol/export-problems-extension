import * as vscode from 'vscode';
import { readOptions } from './configuration';
import {
  collectAllDiagnosticEntries,
  collectFilteredDiagnosticEntries,
  findHiddenDiagnosticEntries,
  formatHiddenDiagnosticsNotice,
  hasMultipleWorkspaceFolders,
  resolveExportTargetPaths,
} from './diagnostics';
import { buildMarkdown } from './markdown/renderMarkdown';
import { deliverMarkdown } from './output/deliverMarkdown';

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
