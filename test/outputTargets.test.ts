import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { TestUri } from './vscodeMock';
import { activateExtension, createVscode, loadExtension } from './exportHost';

test('opens the save dialog without a default location when no folder is open', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-dialog-no-workspace');
  const selectedUri = TestUri.file(path.join(workspaceRoot, 'picked.md'));
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: { outputMode: 'save-dialog', openAfterExport: false },
    saveDialogResult: selectedUri,
  });
  host.vscode.workspace.workspaceFolders = undefined;
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.equal(host.saveDialogs.length, 1);
  assert.equal(host.saveDialogs[0].defaultUri, undefined);
  assert.deepEqual(host.saveDialogs[0].filters, { Markdown: ['md'] });
  assert.equal(host.saveDialogs[0].saveLabel, 'Export Problems');
  assert.deepEqual(host.writes.map((write) => write.uri.fsPath), [selectedUri.fsPath]);
  assert.deepEqual(host.errorMessages, []);
});

test('does not open the export in the clipboard output mode', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-clipboard-open');
  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: { outputMode: 'clipboard', openAfterExport: true },
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.ok(host.getClipboardText()?.includes('Example problem'));
  assert.equal(host.openedDocuments.length, 0);
  assert.equal(host.shownDocuments.length, 0);
  assert.equal(host.writes.length, 0);
  assert.deepEqual(host.informationMessages, ['Problems exported to clipboard.']);
});
