import * as path from 'node:path';
import * as vscode from 'vscode';
import type { DiagnosticEntry, ExportOptions } from './model';
import { resolveSafeWorkspaceTarget } from './output/workspacePathSecurity';
import { isKnownSeverity } from './severity';

// Relative paths need folder names when the window contains multiple workspaces.
export function hasMultipleWorkspaceFolders(): boolean {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
}

// Resolve both target paths because a symlinked workspace has different lexical and canonical roots.
export async function resolveExportTargetPaths(options: ExportOptions): Promise<string[]> {
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
export function collectFilteredDiagnosticEntries(
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
export function collectAllDiagnosticEntries(
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
export function findHiddenDiagnosticEntries(
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
export function formatHiddenDiagnosticsNotice(
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

