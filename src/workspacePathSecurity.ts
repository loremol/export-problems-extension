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

// Returns a portable file name for save-dialog fallback
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

// Selects automatic output for safe local targets or a save-dialog fallback
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

// Resolves a configured path as a strict lexical workspace descendant
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

// Returns a path's canonical form, or undefined when resolution fails
async function tryRealpath(targetPath: string): Promise<string | undefined> {
  try {
    return await realpath(targetPath);
  } catch {
    return undefined;
  }
}

// Finds the nearest existing target path while rejecting symbolic links
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

// Rebuilds and validates a target beneath the canonical workspace root
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

// Resolves a configured target only when it remains safely inside the workspace
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

const pathStateErrorCodes = new Set(['EEXIST', 'EISDIR', 'ELOOP', 'ENOENT', 'ENOTDIR']);

// Returns true when an error can indicate that a path changed during validation
function isPathStateError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    pathStateErrorCodes.has(error.code)
  );
}

// Returns true when two stats identify the same filesystem object
function isSameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

// Writes only while the configured target remains a safe workspace file
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
    if (isPathStateError(error)) {
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
    if (!isPathStateError(error)) {
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
        0o600
      );
    } catch (error) {
      if (isPathStateError(error)) {
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
      if (isPathStateError(error)) {
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

// Returns true when a target is a strict descendant of a root
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
