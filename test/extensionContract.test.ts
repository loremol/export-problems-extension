import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  activateExtension,
  createVscode,
  type ExportConfiguration,
  loadExtension,
} from './exportHost';
import { TestUri } from './vscodeMock';

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

type Manifest = {
  contributes: {
    commands: { command: string }[];
    configuration: {
      properties: Record<string, { default: unknown; enum?: string[] }>;
    };
  };
};

// Compiled tests run from .test-out/test, so the manifest is two levels up.
function readManifest(): Manifest {
  return require(path.resolve(__dirname, '../../package.json')) as Manifest;
}

// Strip the section prefix so the keys match the names readOptions passes to config.get.
function readDeclaredDefaults(): Partial<ExportConfiguration> {
  const { properties } = readManifest().contributes.configuration;
  return Object.fromEntries(
    Object.entries(properties).map(([key, property]) => [
      key.replace(/^exportProblems\./, ''),
      property.default,
    ])
  ) as Partial<ExportConfiguration>;
}

test('contributes the command id that the extension registers', () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-manifest-command');
  const host = createVscode(workspaceRoot, 'problems.md');
  const extension = loadExtension(host.vscode);
  activateExtension(extension);

  assert.deepEqual(
    readManifest().contributes.commands.map((command) => command.command),
    [host.getRegisteredCommandName()]
  );
});

test('declares the enum values the export code accepts', () => {
  const { properties } = readManifest().contributes.configuration;

  assert.deepEqual(properties['exportProblems.minimumSeverity'].enum, [
    'Hint',
    'Information',
    'Warning',
    'Error',
  ]);
  assert.deepEqual(properties['exportProblems.groupBy'].enum, [
    'file',
    'severity',
    'flat-table',
  ]);
  assert.deepEqual(properties['exportProblems.outputMode'].enum, [
    'save-dialog',
    'workspace-file',
    'clipboard',
  ]);
});

test('applies the same defaults the manifest declares', async () => {
  const workspaceRoot = path.join(tmpdir(), 'export-problems-manifest-defaults');
  const selectedUri = TestUri.file(path.join(workspaceRoot, 'picked.md'));

  // An undefined stored value makes the mock return whatever default readOptions passes, so this
  // run is driven entirely by the literals in readOptions.
  const codeDefaults = createVscode(workspaceRoot, undefined, {
    configuration: { outputMode: undefined, openAfterExport: undefined },
    saveDialogResult: selectedUri,
  });
  const manifestDefaults = createVscode(workspaceRoot, undefined, {
    configuration: readDeclaredDefaults(),
    saveDialogResult: selectedUri,
  });

  for (const host of [codeDefaults, manifestDefaults]) {
    const extension = loadExtension(host.vscode);
    activateExtension(extension);
    await host.getRegisteredCommand()();
  }

  assert.equal(
    Buffer.from(manifestDefaults.writes[0].content).toString('utf8'),
    Buffer.from(codeDefaults.writes[0].content).toString('utf8')
  );
  assert.deepEqual(
    manifestDefaults.saveDialogs[0].defaultUri?.fsPath,
    codeDefaults.saveDialogs[0].defaultUri?.fsPath
  );
  assert.deepEqual(manifestDefaults.informationMessages, codeDefaults.informationMessages);
  assert.equal(
    manifestDefaults.openedDocuments.length,
    codeDefaults.openedDocuments.length
  );
});
