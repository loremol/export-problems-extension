import { lstat, realpath } from 'node:fs/promises';
import * as path from 'node:path';

type PathSemantics = Pick<typeof path, 'isAbsolute' | 'relative' | 'sep'>;

const defaultExportFileName = 'problems-export.md';
const invalidPortableFileNameCharacter = /[\u0000-\u001f<>:"/\\|?*]/;
const windowsReservedFileName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

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

export async function resolveSafeWorkspaceTarget(
  workspaceRoot: string,
  configuredPath: string
): Promise<string | undefined> {
  const lexicalRoot = path.resolve(workspaceRoot);
  const lexicalTarget = path.resolve(lexicalRoot, configuredPath);
  if (!isPathStrictlyWithin(lexicalRoot, lexicalTarget)) {
    return undefined;
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(lexicalRoot);
  } catch {
    return undefined;
  }

  const relativeTarget = path.relative(lexicalRoot, lexicalTarget);
  const targetSegments = relativeTarget.split(path.sep);
  let currentPath = lexicalRoot;
  let nearestExistingPath = lexicalRoot;
  let firstMissingSegment = targetSegments.length;

  for (const [index, segment] of targetSegments.entries()) {
    currentPath = path.join(currentPath, segment);
    try {
      const currentStat = await lstat(currentPath);
      if (currentStat.isSymbolicLink()) {
        return undefined;
      }
      nearestExistingPath = currentPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        firstMissingSegment = index;
        break;
      }
      return undefined;
    }
  }

  let canonicalExistingPath: string;
  try {
    canonicalExistingPath = await realpath(nearestExistingPath);
  } catch {
    return undefined;
  }

  if (
    path.relative(canonicalRoot, canonicalExistingPath) !== '' &&
    !isPathStrictlyWithin(canonicalRoot, canonicalExistingPath)
  ) {
    return undefined;
  }

  const canonicalTarget = path.resolve(
    canonicalExistingPath,
    ...targetSegments.slice(firstMissingSegment)
  );
  return isPathStrictlyWithin(canonicalRoot, canonicalTarget)
    ? canonicalTarget
    : undefined;
}

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
