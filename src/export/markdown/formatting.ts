import type * as vscode from 'vscode';

// Format the one-based line number and optional column.
export function formatLocation(diagnostic: vscode.Diagnostic, includeColumn: boolean): string {
  const line = diagnostic.range.start.line + 1;
  if (!includeColumn) {
    return `${line}`;
  }
  const column = diagnostic.range.start.character + 1;
  return `${line}:${column}`;
}

// Format whichever source and code fields the diagnostic provides.
export function formatSourceAndCode(
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
export function formatSourceTag(diagnostic: vscode.Diagnostic, includeSource: boolean): string {
  if (!includeSource) {
    return '';
  }
  const sourceAndCode = formatSourceAndCode(diagnostic, formatInlineText);
  return sourceAndCode ? ` [${sourceAndCode}]` : '';
}

// Collapse line breaks before inserting text into inline Markdown.
export function formatInlineText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

// Escape text for use in a Markdown table cell.
export function formatTableCell(value: string): string {
  return formatInlineText(value).replace(
    /(\\*)\|/g,
    (_match, backslashes: string) => `${backslashes.repeat(2)}\\|`
  );
}

// Normalize diagnostic text because other extensions can supply values with the wrong type.
export function toText(value: unknown): string {
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
