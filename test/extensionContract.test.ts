import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { activateExtension, createVscode, loadExtension } from './exportHost';

test('registers the command id contributed by the manifest', () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-command-id');
  const host = createVscode(workspaceRoot, 'problems.md');
  const extension = loadExtension(host.vscode);

  activateExtension(extension);

  assert.equal(host.getRegisteredCommandName(), 'export-problems.export');
});

test('hands the command registration to the extension subscriptions', () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-subscriptions');
  const host = createVscode(workspaceRoot, 'problems.md');
  const extension = loadExtension(host.vscode);

  const subscriptions = activateExtension(extension);

  assert.equal(subscriptions.length, 1);
  assert.equal(typeof subscriptions[0].dispose, 'function');
});

test('deactivates without throwing', () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-deactivate');
  const host = createVscode(workspaceRoot, 'problems.md');
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  assert.equal(extension.deactivate(), undefined);
});
