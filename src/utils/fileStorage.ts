import * as FileSystem from 'expo-file-system/legacy';
import { FileSystemAbstraction } from '../cloud/fsAbstraction';

const LOGBOOK_DIR = `${FileSystem.documentDirectory}logbook/`;
const PHOTOS_DIR = `${LOGBOOK_DIR}photos/`;
const SIGNATURES_DIR = `${LOGBOOK_DIR}signatures/`;
const CARDS_DIR = `${LOGBOOK_DIR}cards/`;
const SIGNREQUEST_PHOTOS_DIR = `${LOGBOOK_DIR}signrequest_photos/`;

export function signRequestPhotoPath(requestId: string, basename: string): string {
  return `${SIGNREQUEST_PHOTOS_DIR}${requestId}/${basename}`;
}

async function ensureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

export async function copyPhotoToAppStorage(sourceUri: string, entryId: string, index: number): Promise<string> {
  await ensureDir(PHOTOS_DIR);
  const ext = sourceUri.split('.').pop() || 'jpg';
  const destPath = `${PHOTOS_DIR}${entryId}_${index}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destPath });
  return destPath;
}

export async function saveSignaturePng(base64Data: string, signatureId: string): Promise<string> {
  await ensureDir(SIGNATURES_DIR);
  const destPath = `${SIGNATURES_DIR}${signatureId}.png`;
  await FileSystem.writeAsStringAsync(destPath, base64Data, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return destPath;
}

export async function saveCardPhoto(sourceUri: string): Promise<string> {
  await ensureDir(CARDS_DIR);
  const ext = sourceUri.split('.').pop() || 'jpg';
  const destPath = `${CARDS_DIR}sprat_card.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destPath });
  return destPath;
}

export async function deleteFile(path: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) {
    await FileSystem.deleteAsync(path);
  }
}

export async function saveSignRequestPhoto(
  fs: FileSystemAbstraction,
  requestId: string,
  basename: string,
  bytes: Uint8Array,
): Promise<string> {
  const dir = `${SIGNREQUEST_PHOTOS_DIR}${requestId}/`;
  await fs.ensureDir(dir);
  const destPath = `${dir}${basename}`;
  await fs.writeBytes(destPath, bytes);
  return destPath;
}

export async function deleteSignRequestPhotosDir(
  fs: FileSystemAbstraction,
  requestId: string,
  knownPaths: string[] = [],
): Promise<void> {
  for (const p of knownPaths) {
    if (p) {
      try { await fs.deletePath(p); } catch {}
    }
  }
  const dir = `${SIGNREQUEST_PHOTOS_DIR}${requestId}/`;
  try { await fs.deletePath(dir); } catch {}
}
