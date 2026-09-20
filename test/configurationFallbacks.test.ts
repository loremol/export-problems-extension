import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { createRange, TestUri } from './vscodeMock';
import { activateExtension, createVscode, loadExtension } from './exportHost';

test('keeps the summary when includeSummary is not a boolean', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-boolean-summary');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: {
      outputMode: 'clipboard',
      includeSummary: 0 as unknown as boolean,
    },
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.ok(host.getClipboardText()?.startsWith('# Problems'));
});

test('omits the export date when includeExportDate is not a boolean', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-boolean-date');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: {
      outputMode: 'clipboard',
      includeExportDate: 'yes' as unknown as boolean,
    },
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.ok(!host.getClipboardText()?.includes('Generated:'));
});

test('omits the problem count when includeProblemCount is not a boolean', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-boolean-count');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: {
      outputMode: 'clipboard',
      includeProblemCount: 1 as unknown as boolean,
    },
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.ok(!host.getClipboardText()?.includes('Total problems:'));
});

test('keeps the source tag when includeSource is not a boolean', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-boolean-source');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: {
      outputMode: 'clipboard',
      includeSummary: false,
      includeSource: 0 as unknown as boolean,
    },
    diagnostics: [{
      severity: 0,
      range: createRange(),
      message: 'Example problem',
      source: 'eslint',
      code: 'no-unused-vars',
    }],
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.ok(host.getClipboardText()?.includes('[eslint, no-unused-vars]'));
});

test('keeps the column when includeColumn is not a boolean', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-boolean-column');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: {
      outputMode: 'clipboard',
      includeSummary: false,
      includeColumn: '' as unknown as boolean,
    },
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.ok(host.getClipboardText()?.includes('**Line 1:1**'));
});

test('opens the export when openAfterExport is not a boolean', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-boolean-open');
  const selectedUri = TestUri.file(path.join(workspaceRoot, 'chosen.md'));
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: {
      outputMode: 'save-dialog',
      openAfterExport: 0 as unknown as boolean,
    },
    saveDialogResult: selectedUri,
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.deepEqual(host.openedDocuments.map((uri) => uri.fsPath), [selectedUri.fsPath]);
  assert.deepEqual(host.shownDocuments.map((uri) => uri.fsPath), [selectedUri.fsPath]);
});
