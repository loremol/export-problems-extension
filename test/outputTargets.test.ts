import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { createRange, TestUri } from './vscodeMock';
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

test('requires the save dialog for a workspace that is not on the local file system', async () => {
  const remoteRoot = path.join(path.sep, 'remote', 'workspace');
  const selectedUri = new TestUri('vscode-remote', path.join(remoteRoot, 'problems.md'));
  const host = createVscode(remoteRoot, 'problems.md', {
    configuration: { outputMode: 'workspace-file', openAfterExport: false },
    saveDialogResult: selectedUri,
  });
  host.vscode.workspace.workspaceFolders = [{
    uri: new TestUri('vscode-remote', remoteRoot),
    name: 'workspace',
    index: 0,
  }];
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  assert.equal(host.saveDialogs.length, 1);
  assert.equal(host.saveDialogs[0].defaultUri?.scheme, 'vscode-remote');
  assert.equal(
    host.saveDialogs[0].defaultUri?.fsPath,
    path.join(remoteRoot, 'problems.md')
  );
  assert.deepEqual(host.writes.map((write) => write.uri.fsPath), [selectedUri.fsPath]);
  assert.deepEqual(host.errorMessages, []);
});

test('exports an untitled buffer whose path matches the export target', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-untitled-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const host = createVscode(workspaceRoot, 'problems.md', {
    configuration: { includeSummary: false },
    diagnosticEntries: [
      [TestUri.file(path.join(workspaceRoot, 'problems.md')), [{
        severity: 1,
        range: createRange(),
        message: 'Stale problem from the previous export',
      }]],
      // Same path, different scheme: an unsaved buffer is never the export target.
      [new TestUri('untitled', path.join(workspaceRoot, 'problems.md')), [{
        severity: 0,
        range: createRange(),
        message: 'Unsaved buffer problem',
      }]],
    ],
  });
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  const written = await readFile(path.join(workspaceRoot, 'problems.md'), 'utf8');
  assert.ok(written.includes('Unsaved buffer problem'));
  assert.ok(!written.includes('Stale problem from the previous export'));
});

test('keeps problems at the configured export path when the workspace is not on the local file system', async () => {
  const remoteRoot = path.join(path.sep, 'remote', 'workspace');
  const selectedUri = new TestUri('vscode-remote', path.join(remoteRoot, 'problems.md'));
  const host = createVscode(remoteRoot, 'problems.md', {
    configuration: { outputMode: 'workspace-file', openAfterExport: false, includeSummary: false },
    saveDialogResult: selectedUri,
    // A local file can share the export name while the workspace itself is remote.
    diagnosticEntries: [
      [TestUri.file(path.join(remoteRoot, 'problems.md')), [{
        severity: 0,
        range: createRange(),
        message: 'Problem in a local file that shares the export name',
      }]],
    ],
  });
  host.vscode.workspace.workspaceFolders = [{
    uri: new TestUri('vscode-remote', remoteRoot),
    name: 'workspace',
    index: 0,
  }];
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  await host.getRegisteredCommand()();

  const written = Buffer.from(host.writes[0].content).toString('utf8');
  assert.ok(written.includes('Problem in a local file that shares the export name'));
  assert.deepEqual(host.errorMessages, []);
});
