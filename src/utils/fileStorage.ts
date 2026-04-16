import * as FileSystem from 'expo-file-system/legacy';

const LOGBOOK_DIR = `${FileSystem.documentDirectory}logbook/`;
const PHOTOS_DIR = `${LOGBOOK_DIR}photos/`;
const SIGNATURES_DIR = `${LOGBOOK_DIR}signatures/`;
const CARDS_DIR = `${LOGBOOK_DIR}cards/`;

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
