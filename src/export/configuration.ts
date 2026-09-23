import * as vscode from 'vscode';
import type { ExportOptions } from './model';
import { readSeverityThreshold, severityLabels } from './severity';

// Read a string setting, or use its default when the stored value has another type.
function readStringSetting<T extends string>(
  config: vscode.WorkspaceConfiguration,
  section: string,
  defaultValue: T
): T {
  // VS Code stores settings verbatim, so a declared "string" can still read back as any JSON value.
  const value = config.get<unknown>(section, defaultValue);
  return typeof value === 'string' ? (value as T) : defaultValue;
}

// Read a boolean setting, or use its default when the stored value has another type.
function readBooleanSetting(
  config: vscode.WorkspaceConfiguration,
  section: string,
  defaultValue: boolean
): boolean {
  // VS Code stores settings verbatim, so a declared "boolean" can still read back as any JSON value.
  const value = config.get<unknown>(section, defaultValue);
  return typeof value === 'boolean' ? value : defaultValue;
}

// Load the export options from the workspace configuration.
export function readOptions(): ExportOptions {
  const config = vscode.workspace.getConfiguration('exportProblems');
  const minimumSeverityName = readStringSetting(config, 'minimumSeverity', 'Hint');
  const threshold = readSeverityThreshold(minimumSeverityName);
  return {
    threshold,
    minimumSeverityName: severityLabels[threshold],
    groupBy: readStringSetting<ExportOptions['groupBy']>(config, 'groupBy', 'file'),
    includeSummary: readBooleanSetting(config, 'includeSummary', true),
    summaryTitle: readStringSetting(config, 'summaryTitle', 'Problems'),
    includeExportDate: readBooleanSetting(config, 'includeExportDate', false),
    includeProblemCount: readBooleanSetting(config, 'includeProblemCount', false),
    includeSource: readBooleanSetting(config, 'includeSource', true),
    includeColumn: readBooleanSetting(config, 'includeColumn', true),
    defaultFileName: readStringSetting(config, 'defaultFileName', 'problems.md'),
    outputMode: readStringSetting<ExportOptions['outputMode']>(config, 'outputMode', 'save-dialog'),
    openAfterExport: readBooleanSetting(config, 'openAfterExport', true),
  };
}
