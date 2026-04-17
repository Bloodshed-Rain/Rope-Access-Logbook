import * as FileSystem from 'expo-file-system/legacy';

function getDocDir(): string {
  return FileSystem.documentDirectory ?? '';
}

function isAbsolute(path: string): boolean {
  return path.startsWith('file://') || path.startsWith('content://');
}

export function normalizeAppPath(path: string): string {
  if (!path) return path;
  const dir = getDocDir();
  if (dir && path.startsWith(dir)) {
    return path.slice(dir.length);
  }
  if (!isAbsolute(path)) {
    return path;
  }
  // content:// URIs (Android gallery) are valid non-docDir absolute paths — pass through silently.
  if (path.startsWith('content://')) {
    return path;
  }
  // Unexpected file:// path outside documentDirectory — worth flagging as a possible bug.
  console.warn(`[paths] normalizeAppPath: file path does not start with documentDirectory: ${path}`);
  return path;
}

export function rehydrateAppPath(path: string): string {
  if (!path) return path;
  if (isAbsolute(path)) return path;
  return getDocDir() + path;
}
