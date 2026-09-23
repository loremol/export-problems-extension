import type * as vscode from 'vscode';

export type DiagnosticEntry = [vscode.Uri, vscode.Diagnostic[]];

export interface ExportOptions {
  threshold: vscode.DiagnosticSeverity;
  minimumSeverityName: string;
  groupBy: 'file' | 'severity' | 'flat-table';
  includeSummary: boolean;
  summaryTitle: string;
  includeExportDate: boolean;
  includeProblemCount: boolean;
  includeSource: boolean;
  includeColumn: boolean;
  defaultFileName: string;
  outputMode: 'save-dialog' | 'workspace-file' | 'clipboard';
  openAfterExport: boolean;
}
