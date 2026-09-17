import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  getSafeDialogFileName,
  isPathStrictlyWithin,
  resolveSafeWorkspaceTarget,
  selectWorkspaceFileTarget,
  writeFileToSafeWorkspaceTarget,
} from '../src/workspacePathSecurity';

function isPermissionError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'EPERM' || error.code === 'EACCES')
  );
}

test('resolves a new file beneath a canonical workspace root', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const canonicalRoot = await realpath(workspaceRoot);
  const expectedTarget = path.join(canonicalRoot, 'problems.md');
  const actual = await resolveSafeWorkspaceTarget(workspaceRoot, 'problems.md');

  assert.equal(actual, expectedTarget);
});

test('rejects targets that are not strict workspace descendants', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const workspaceRoot = path.join(tempRoot, 'workspace');
  await mkdir(workspaceRoot);

  const cases = [
    { name: 'empty path', configuredPath: '' },
    { name: 'current directory', configuredPath: '.' },
    { name: 'normalized current directory', configuredPath: `nested${path.sep}..` },
    { name: 'absolute outside path', configuredPath: path.join(tempRoot, 'outside.md') },
    {
      name: 'sibling-prefix path',
      configuredPath: path.join(`${workspaceRoot}-other`, 'problems.md'),
    },
  ];

  for (const { name, configuredPath } of cases) {
    const actual = await resolveSafeWorkspaceTarget(workspaceRoot, configuredPath);
    assert.equal(actual, undefined, name);
  }
});

test('resolves missing target segments beneath an existing workspace directory', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const exportsDirectory = path.join(workspaceRoot, 'exports');
  await mkdir(exportsDirectory);

  const canonicalRoot = await realpath(workspaceRoot);
  const expectedTarget = path.join(canonicalRoot, 'exports', 'nested', 'problems.md');
  const actual = await resolveSafeWorkspaceTarget(
    workspaceRoot,
    path.join('exports', 'nested', 'problems.md')
  );

  assert.equal(actual, expectedTarget);
});

test('rejects a target below an intermediate regular file', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  await writeFile(path.join(workspaceRoot, 'exports'), 'not a directory');

  const actual = await resolveSafeWorkspaceTarget(
    workspaceRoot,
    path.join('exports', 'problems.md')
  );

  assert.equal(actual, undefined);
});

test('resolves an existing regular file beneath the workspace', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const exportsDirectory = path.join(workspaceRoot, 'exports');
  const targetPath = path.join(exportsDirectory, 'problems.md');
  await mkdir(exportsDirectory);
  await writeFile(targetPath, 'existing export');

  const expectedTarget = await realpath(targetPath);
  const actual = await resolveSafeWorkspaceTarget(
    workspaceRoot,
    path.join('exports', 'problems.md')
  );

  assert.equal(actual, expectedTarget);
});

test('rejects an existing directory target and selects a save-dialog fallback', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  await mkdir(path.join(workspaceRoot, 'problems.md'));

  const resolvedTarget = await resolveSafeWorkspaceTarget(workspaceRoot, 'problems.md');
  const selectedTarget = await selectWorkspaceFileTarget(
    'file',
    workspaceRoot,
    'problems.md'
  );

  assert.deepEqual(
    { resolvedTarget, selectedTarget },
    {
      resolvedTarget: undefined,
      selectedTarget: { kind: 'save-dialog', fileName: 'problems.md' },
    }
  );
});

test('fails closed when the workspace root cannot be canonicalized', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const missingWorkspace = path.join(tempRoot, 'missing-workspace');
  const actual = await resolveSafeWorkspaceTarget(missingWorkspace, 'problems.md');

  assert.equal(actual, undefined);
});

test('rejects a target that is a symbolic link', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const workspaceRoot = path.join(tempRoot, 'workspace');
  const outsideFile = path.join(tempRoot, 'outside.md');
  const targetPath = path.join(workspaceRoot, 'problems.md');
  await mkdir(workspaceRoot);
  await writeFile(outsideFile, 'do not overwrite');

  try {
    await symlink(outsideFile, targetPath, 'file');
  } catch (error) {
    if (isPermissionError(error)) {
      t.skip('Creating file symlinks is not permitted on this Windows host.');
      return;
    }
    throw error;
  }

  const actual = await resolveSafeWorkspaceTarget(workspaceRoot, 'problems.md');

  assert.equal(actual, undefined);
});

test('rejects broken and workspace-internal symbolic-link targets', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const internalFile = path.join(workspaceRoot, 'existing.md');
  await writeFile(internalFile, 'existing export');

  const brokenLink = path.join(workspaceRoot, 'broken.md');
  const internalLink = path.join(workspaceRoot, 'internal.md');
  try {
    await symlink(path.join(workspaceRoot, 'missing.md'), brokenLink, 'file');
    await symlink(internalFile, internalLink, 'file');
  } catch (error) {
    if (isPermissionError(error)) {
      t.skip('Creating file symlinks is not permitted on this Windows host.');
      return;
    }
    throw error;
  }

  const brokenTarget = await resolveSafeWorkspaceTarget(workspaceRoot, 'broken.md');
  const internalTarget = await resolveSafeWorkspaceTarget(workspaceRoot, 'internal.md');

  assert.deepEqual(
    { brokenTarget, internalTarget },
    { brokenTarget: undefined, internalTarget: undefined }
  );
});

test('rejects a target beneath a symbolic-link directory', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const workspaceRoot = path.join(tempRoot, 'workspace');
  const outsideDirectory = path.join(tempRoot, 'outside');
  const linkedDirectory = path.join(workspaceRoot, 'exports');
  await mkdir(workspaceRoot);
  await mkdir(outsideDirectory);

  try {
    await symlink(
      outsideDirectory,
      linkedDirectory,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  } catch (error) {
    if (isPermissionError(error)) {
      t.skip('Creating directory links is not permitted on this host.');
      return;
    }
    throw error;
  }

  const actual = await resolveSafeWorkspaceTarget(
    workspaceRoot,
    path.join('exports', 'problems.md')
  );

  assert.equal(actual, undefined);
});

test('selects automatic output only for a proven local workspace target', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const canonicalRoot = await realpath(workspaceRoot);
  const automatic = await selectWorkspaceFileTarget('file', workspaceRoot, 'problems.md');
  const traversal = await selectWorkspaceFileTarget('file', workspaceRoot, '../../.bashrc');
  const remote = await selectWorkspaceFileTarget(
    'vscode-remote',
    '/remote/workspace',
    'nested/problems.md'
  );

  assert.deepEqual(automatic, {
    kind: 'automatic',
    targetPath: path.join(canonicalRoot, 'problems.md'),
  });
  assert.deepEqual(traversal, { kind: 'save-dialog', fileName: '.bashrc' });
  assert.deepEqual(remote, { kind: 'save-dialog', fileName: 'problems.md' });
});

test('derives a portable workspace-local name for fallback save dialogs', () => {
  const cases = [
    { configuredPath: '../../.bashrc', expected: '.bashrc' },
    { configuredPath: '..\\..\\profile.md', expected: 'profile.md' },
    { configuredPath: 'nested/report.md', expected: 'report.md' },
    { configuredPath: '', expected: 'problems.md' },
    { configuredPath: '../..', expected: 'problems.md' },
    { configuredPath: 'CON', expected: 'problems.md' },
    { configuredPath: 'report.md:stream', expected: 'problems.md' },
    { configuredPath: 'report?.md', expected: 'problems.md' },
    { configuredPath: 'report.md.', expected: 'problems.md' },
  ];

  for (const { configuredPath, expected } of cases) {
    const actual = getSafeDialogFileName(configuredPath);
    assert.equal(actual, expected, configuredPath || '<empty>');
  }
});

test('recognizes only strict descendants with POSIX and Windows path semantics', () => {
  const cases = [
    { pathApi: path.posix, root: '/workspace', target: '/workspace/export.md', expected: true },
    { pathApi: path.posix, root: '/workspace', target: '/workspace', expected: false },
    { pathApi: path.posix, root: '/workspace', target: '/workspace-other/export.md', expected: false },
    { pathApi: path.posix, root: '/workspace', target: '/outside/export.md', expected: false },
    { pathApi: path.win32, root: 'C:\\workspace', target: 'C:\\workspace\\export.md', expected: true },
    { pathApi: path.win32, root: 'C:\\workspace', target: 'C:\\workspace', expected: false },
    { pathApi: path.win32, root: 'C:\\workspace', target: 'C:\\workspace-other\\export.md', expected: false },
    { pathApi: path.win32, root: 'C:\\workspace', target: 'D:\\export.md', expected: false },
  ];

  for (const { pathApi, root, target, expected } of cases) {
    const actual = isPathStrictlyWithin(root, target, pathApi);
    assert.equal(actual, expected, `${target} within ${root}`);
  }
});

// Permission bits do not restrict a superuser, so the assertions below would be vacuous.
function isSuperuser(): boolean {
  return process.getuid?.() === 0;
}

test('declines an unwritable existing target instead of throwing', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  if (isSuperuser()) {
    t.skip('Permission bits do not restrict the superuser.');
    return;
  }

  const targetPath = path.join(workspaceRoot, 'problems.md');
  const sentinel = 'read-only export';
  await writeFile(targetPath, sentinel);
  await chmod(targetPath, 0o444);

  const actual = await writeFileToSafeWorkspaceTarget(
    workspaceRoot,
    'problems.md',
    Buffer.from('replacement')
  );

  assert.equal(actual, undefined);
  assert.equal(await readFile(targetPath, 'utf8'), sentinel);
});

test('declines a target inside an unwritable directory instead of throwing', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'export-problems-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  if (process.platform === 'win32' || isSuperuser()) {
    t.skip('Directory permission bits do not deny creation on this host.');
    return;
  }

  const exportsDirectory = path.join(workspaceRoot, 'exports');
  await mkdir(exportsDirectory);
  await chmod(exportsDirectory, 0o555);

  const actual = await writeFileToSafeWorkspaceTarget(
    workspaceRoot,
    path.join('exports', 'problems.md'),
    Buffer.from('replacement')
  );

  assert.equal(actual, undefined);
});
