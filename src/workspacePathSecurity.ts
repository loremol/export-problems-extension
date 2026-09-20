import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, realpath, type FileHandle } from 'node:fs/promises';
import * as path from 'node:path';

type PathSemantics = Pick<typeof path, 'isAbsolute' | 'relative' | 'sep'>;

interface LexicalWorkspaceTarget {
  lexicalRoot: string;
  targetSegments: string[];
}

interface ExistingTargetPath {
  nearestExistingPath: string;
  missingSegments: string[];
}

const defaultExportFileName = 'problems.md';
const invalidPortableFileNameCharacter = /[\u0000-\u001f<>:"/\\|?*]/;
const windowsReservedFileName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

// Derive a portable file name for the save-dialog fallback.
export function getSafeDialogFileName(configuredPath: string): string {
  const fileName = path.win32.basename(path.posix.basename(configuredPath));
  if (
    !fileName ||
    fileName === '.' ||
    fileName === '..' ||
    invalidPortableFileNameCharacter.test(fileName) ||
    /[ .]$/.test(fileName) ||
    windowsReservedFileName.test(fileName)
  ) {
    return defaultExportFileName;
  }
  return fileName;
}

export type WorkspaceFileTarget =
  | { kind: 'automatic'; targetPath: string }
  | { kind: 'save-dialog'; fileName: string };

// Use automatic output for a safe local target; otherwise require the save dialog.
export async function selectWorkspaceFileTarget(
  workspaceScheme: string,
  workspacePath: string,
  configuredPath: string
): Promise<WorkspaceFileTarget> {
  if (workspaceScheme === 'file') {
    const targetPath = await resolveSafeWorkspaceTarget(workspacePath, configuredPath);
    if (targetPath) {
      return { kind: 'automatic', targetPath };
    }
  }

  return {
    kind: 'save-dialog',
    fileName: getSafeDialogFileName(configuredPath),
  };
}

// Resolve the configured path only if it is lexically inside the workspace.
function resolveLexicalWorkspaceTarget(
  workspaceRoot: string,
  configuredPath: string
): LexicalWorkspaceTarget | undefined {
  const lexicalRoot = path.resolve(workspaceRoot);
  const lexicalTarget = path.resolve(lexicalRoot, configuredPath);
  if (!isPathStrictlyWithin(lexicalRoot, lexicalTarget)) {
    return undefined;
  }

  return {
    lexicalRoot,
    targetSegments: path.relative(lexicalRoot, lexicalTarget).split(path.sep),
  };
}

// Resolve a canonical path without exposing filesystem errors to the caller.
async function tryRealpath(targetPath: string): Promise<string | undefined> {
  try {
    return await realpath(targetPath);
  } catch {
    return undefined;
  }
}

// Find the nearest existing part of the target path, rejecting symbolic links along the way.
async function findNearestExistingTargetPath(
  lexicalRoot: string,
  targetSegments: string[]
): Promise<ExistingTargetPath | undefined> {
  let currentPath = lexicalRoot;
  let nearestExistingPath = lexicalRoot;

  for (const [index, segment] of targetSegments.entries()) {
    currentPath = path.join(currentPath, segment);
    try {
      const currentStat = await lstat(currentPath);
      const isTarget = index === targetSegments.length - 1;
      if (
        currentStat.isSymbolicLink() ||
        (isTarget && (!currentStat.isFile() || currentStat.nlink !== 1)) ||
        (!isTarget && !currentStat.isDirectory())
      ) {
        return undefined;
      }
      nearestExistingPath = currentPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return undefined;
      }
      return {
        nearestExistingPath,
        missingSegments: targetSegments.slice(index),
      };
    }
  }

  return { nearestExistingPath, missingSegments: [] };
}

// Rebuild the target below the canonical workspace root and validate the result.
function resolveCanonicalWorkspaceTarget(
  canonicalRoot: string,
  canonicalExistingPath: string,
  missingSegments: string[]
): string | undefined {
  if (
    path.relative(canonicalRoot, canonicalExistingPath) !== '' &&
    !isPathStrictlyWithin(canonicalRoot, canonicalExistingPath)
  ) {
    return undefined;
  }

  const canonicalTarget = path.resolve(canonicalExistingPath, ...missingSegments);
  return isPathStrictlyWithin(canonicalRoot, canonicalTarget)
    ? canonicalTarget
    : undefined;
}

// Resolve the configured target only while it remains inside the workspace.
export async function resolveSafeWorkspaceTarget(
  workspaceRoot: string,
  configuredPath: string
): Promise<string | undefined> {
  const lexicalTarget = resolveLexicalWorkspaceTarget(workspaceRoot, configuredPath);
  if (!lexicalTarget) {
    return undefined;
  }

  const { lexicalRoot, targetSegments } = lexicalTarget;
  const canonicalRoot = await tryRealpath(lexicalRoot);
  if (!canonicalRoot) {
    return undefined;
  }

  const existingTarget = await findNearestExistingTargetPath(
    lexicalRoot,
    targetSegments
  );
  if (!existingTarget) {
    return undefined;
  }

  const canonicalExistingPath = await tryRealpath(
    existingTarget.nearestExistingPath
  );
  if (!canonicalExistingPath) {
    return undefined;
  }

  return resolveCanonicalWorkspaceTarget(
    canonicalRoot,
    canonicalExistingPath,
    existingTarget.missingSegments
  );
}

const unusableTargetErrorCodes = new Set([
  // The path changed shape during validation.
  'EEXIST',
  'EISDIR',
  'ELOOP',
  'ENOENT',
  'ENOTDIR',
  // The target or one of its parents denies writing.
  'EACCES',
  'EPERM',
  'EROFS',
]);

// Check whether the caller should fall back because the target is unusable.
function isUnusableTargetError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    unusableTargetErrorCodes.has(error.code)
  );
}

// Compare the device and inode to confirm that both stats describe the same file.
function isSameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

// Write only while the configured target remains a safe workspace file.
export async function writeFileToSafeWorkspaceTarget(
  workspaceRoot: string,
  configuredPath: string,
  content: Uint8Array
): Promise<string | undefined> {
  const initialTarget = await resolveSafeWorkspaceTarget(workspaceRoot, configuredPath);
  if (!initialTarget) {
    return undefined;
  }

  try {
    await mkdir(path.dirname(initialTarget), { recursive: true });
  } catch (error) {
    if (isUnusableTargetError(error)) {
      return undefined;
    }
    throw error;
  }

  const targetPath = await resolveSafeWorkspaceTarget(workspaceRoot, configuredPath);
  if (targetPath !== initialTarget) {
    return undefined;
  }

  const noFollow = constants.O_NOFOLLOW ?? 0;
  let targetHandle: FileHandle | undefined;
  try {
    targetHandle = await open(targetPath, constants.O_WRONLY | noFollow);
  } catch (error) {
    if (!isUnusableTargetError(error)) {
      throw error;
    }
  }

  if (!targetHandle) {
    const targetBeforeCreation = await resolveSafeWorkspaceTarget(
      workspaceRoot,
      configuredPath
    );
    if (targetBeforeCreation !== targetPath) {
      return undefined;
    }

    try {
      targetHandle = await open(
        targetPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
        // Let the umask choose the mode, as it does for ordinary writes. Existing exports keep
        // that same mode, so the result does not depend on whether the file already existed.
        0o666
      );
    } catch (error) {
      if (isUnusableTargetError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  try {
    const currentTarget = await resolveSafeWorkspaceTarget(workspaceRoot, configuredPath);
    if (currentTarget !== targetPath) {
      return undefined;
    }

    let currentStat: Stats;
    try {
      currentStat = await lstat(targetPath);
    } catch (error) {
      if (isUnusableTargetError(error)) {
        return undefined;
      }
      throw error;
    }

    const openedStat = await targetHandle.stat();
    if (
      !openedStat.isFile() ||
      openedStat.nlink !== 1 ||
      currentStat.isSymbolicLink() ||
      !currentStat.isFile() ||
      currentStat.nlink !== 1 ||
      !isSameFile(openedStat, currentStat)
    ) {
      return undefined;
    }

    await targetHandle.truncate(0);
    await targetHandle.writeFile(content);
    return targetPath;
  } finally {
    await targetHandle.close();
  }
}

// Check whether the target is a strict descendant of the root.
export function isPathStrictlyWithin(
  rootPath: string,
  targetPath: string,
  pathApi: PathSemantics = path
): boolean {
  const relativePath = pathApi.relative(rootPath, targetPath);
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(relativePath)
  );
}
