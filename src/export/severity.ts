import * as vscode from 'vscode';

export const severityLabels: Record<vscode.DiagnosticSeverity, string> = {
  [vscode.DiagnosticSeverity.Error]: 'Error',
  [vscode.DiagnosticSeverity.Warning]: 'Warning',
  [vscode.DiagnosticSeverity.Information]: 'Information',
  [vscode.DiagnosticSeverity.Hint]: 'Hint',
};

const severityHeadings: Record<vscode.DiagnosticSeverity, string> = {
  [vscode.DiagnosticSeverity.Error]: 'Errors',
  [vscode.DiagnosticSeverity.Warning]: 'Warnings',
  [vscode.DiagnosticSeverity.Information]: 'Information',
  [vscode.DiagnosticSeverity.Hint]: 'Hints',
};

const severityOrder: vscode.DiagnosticSeverity[] = [
  vscode.DiagnosticSeverity.Error,
  vscode.DiagnosticSeverity.Warning,
  vscode.DiagnosticSeverity.Information,
  vscode.DiagnosticSeverity.Hint,
];

// TypeScript erases enum constraints at runtime. Diagnostics from other extensions can therefore
// carry a severity outside the four declared values.
const unknownSeverityLabel = 'Unknown severity';
const unknownSeverityHeading = 'Unknown severities';

// Check whether VS Code declares this severity.
export function isKnownSeverity(severity: vscode.DiagnosticSeverity): boolean {
  return severityOrder.includes(severity);
}

// Use a shared fallback label for severities outside the declared range.
export function formatSeverityLabel(severity: vscode.DiagnosticSeverity): string {
  return isKnownSeverity(severity) ? severityLabels[severity] : unknownSeverityLabel;
}

// Put known severity sections first and collect unrecognized values in the last section.
export const severitySections: ReadonlyArray<{
  heading: string;
  includesSeverity: (severity: vscode.DiagnosticSeverity) => boolean;
}> = [
  ...severityOrder.map((sectionSeverity) => ({
    heading: severityHeadings[sectionSeverity],
    includesSeverity: (severity: vscode.DiagnosticSeverity) => severity === sectionSeverity,
  })),
  {
    heading: unknownSeverityHeading,
    includesSeverity: (severity: vscode.DiagnosticSeverity) => !isKnownSeverity(severity),
  },
];

const severityThresholds: Record<string, vscode.DiagnosticSeverity> = {
  Error: vscode.DiagnosticSeverity.Error,
  Warning: vscode.DiagnosticSeverity.Warning,
  Information: vscode.DiagnosticSeverity.Information,
  Hint: vscode.DiagnosticSeverity.Hint,
};

// Look up configured severity names without reading inherited properties.
export function readSeverityThreshold(severityName: string): vscode.DiagnosticSeverity {
  return Object.hasOwn(severityThresholds, severityName)
    ? severityThresholds[severityName]
    : vscode.DiagnosticSeverity.Hint;
}
