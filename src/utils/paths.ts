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
  // Absolute but does not match docDir prefix — log and return as-is.
  if (typeof console !== 'undefined') {
    console.warn(`[paths] normalizeAppPath: path does not start with documentDirectory: ${path}`);
  }
  return path;
}

export function rehydrateAppPath(path: string): string {
  if (!path) return path;
  if (isAbsolute(path)) return path;
  return getDocDir() + path;
}
