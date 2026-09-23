import * as vscode from 'vscode';
import type { DiagnosticEntry, ExportOptions } from '../model';
import { formatSeverityLabel, severitySections } from '../severity';
import {
  formatInlineText,
  formatLocation,
  formatSourceAndCode,
  formatSourceTag,
  formatTableCell,
  toText,
} from './formatting';

// Build the complete Markdown document with the selected grouping.
export function buildMarkdown(
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
