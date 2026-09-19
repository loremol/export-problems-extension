import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import {
  describeError,
  ExportStepError,
  formatExportFailure,
  runExportStep,
} from '../src/exportErrors';

test('has no VS Code module dependency', () => {
  const source = readFileSync(
    path.resolve(__dirname, '../../src/exportErrors.ts'),
    'utf8'
  );

  assert.ok(!source.includes("'vscode'") && !source.includes('"vscode"'));
});

test('describes an error by its message', () => {
  assert.equal(describeError(new Error('permission denied')), 'permission denied');
});

test('appends an error code the message does not already carry', () => {
  // VS Code's FileSystemError carries its code only as a property.
  const error = Object.assign(new Error('Unable to write file'), { code: 'NoPermissions' });
  assert.equal(describeError(error), 'Unable to write file (NoPermissions)');
});

test('does not repeat an error code the message already carries', () => {
  // Node's errno messages begin with their own code.
  const error = Object.assign(
    new Error("EACCES: permission denied, open '/etc/problems.md'"),
    { code: 'EACCES' }
  );
  assert.equal(describeError(error), "EACCES: permission denied, open '/etc/problems.md'");
});

test('collapses line breaks in a described cause', () => {
  assert.equal(describeError(new Error('first line\nsecond line')), 'first line second line');
});

test('abbreviates a cause too long for a notification', () => {
  const described = describeError(new Error('x'.repeat(400)));

  assert.equal(described.length, 300);
  assert.ok(described.endsWith('…'));
});

test('keeps an appended error code within the cause length limit', () => {
  const error = Object.assign(new Error('x'.repeat(400)), { code: 'NoPermissions' });
  const described = describeError(error);

  assert.equal(described.length, 300);
  assert.ok(described.endsWith('… (NoPermissions)'));
});

test('describes a thrown non-error value', () => {
  assert.equal(describeError('the clipboard is unavailable'), 'the clipboard is unavailable');
});

test('falls back to the code, then to a generic description, for an empty message', () => {
  assert.equal(describeError(Object.assign(new Error(''), { code: 'EIO' })), 'EIO');
  assert.equal(describeError(new Error('')), 'unknown error');
});

test('returns the value of a successful export step', async () => {
  assert.equal(await runExportStep('open the save dialog', () => 'result'), 'result');
});

test('tags a failed export step with the step and preserves the cause', async () => {
  const cause = new Error('no clipboard provider');

  const failure = await runExportStep('copy the export to the clipboard', () => {
    throw cause;
  }).then(
    () => undefined,
    (error: unknown) => error
  );

  assert.ok(failure instanceof ExportStepError);
  assert.equal(failure.step, 'copy the export to the clipboard');
  assert.equal(failure.cause, cause);
});

test('phrases a tagged failure by its step', () => {
  const failure = new ExportStepError('write the export to problems.md', new Error('disk full'));

  assert.equal(
    formatExportFailure(failure),
    'Could not write the export to problems.md: disk full.'
  );
});

test('phrases an untagged failure as a command failure', () => {
  assert.equal(
    formatExportFailure(new Error('Invalid string length')),
    'Export Problems to Markdown failed: Invalid string length.'
  );
});

test('does not add a second period to a cause that ends a sentence', () => {
  assert.equal(
    formatExportFailure(new Error('The file is a directory.')),
    'Export Problems to Markdown failed: The file is a directory.'
  );
});
