import { lstat, realpath } from 'node:fs/promises';
import * as path from 'node:path';

type PathSemantics = Pick<typeof path, 'isAbsolute' | 'relative' | 'sep'>;

interface LexicalWorkspaceTarget {
  lexicalRoot: string;
  targetSegments: string[];
}

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

async function tryRealpath(targetPath: string): Promise<string | undefined> {
  try {
    return await realpath(targetPath);
  } catch {
    return undefined;
  }
}

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

  const canonicalExistingPath = await tryRealpath(nearestExistingPath);
  if (!canonicalExistingPath) {
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
