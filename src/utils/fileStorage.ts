import * as FileSystem from 'expo-file-system/legacy';
import { FileSystemAbstraction } from '../cloud/fsAbstraction';

const LOGBOOK_DIR = `${FileSystem.documentDirectory}logbook/`;
const PHOTOS_DIR = `${LOGBOOK_DIR}photos/`;
const SIGNATURES_DIR = `${LOGBOOK_DIR}signatures/`;
const CARDS_DIR = `${LOGBOOK_DIR}cards/`;
const AVATARS_DIR = `${LOGBOOK_DIR}avatars/`;
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

// Mirrors saveCardPhoto: copies the picked / shot image into the logbook
// avatars dir under a deterministic name. Suffixed with a timestamp so the
// same file path doesn't get cached by <Image> after the user re-picks.
// Gear photo: deterministic filename under PHOTOS_DIR so the on-device path
// matches the cloud storage-key convention (`assets/gearphoto_{id}.{ext}`),
// the way entry photos do. Lets the same path round-trip through restore
// without diverging from gear.photo_path.
export async function saveGearPhoto(sourceUri: string, gearId: string): Promise<string> {
  await ensureDir(PHOTOS_DIR);
  const ext = sourceUri.split('.').pop() || 'jpg';
  const destPath = `${PHOTOS_DIR}gearphoto_${gearId}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destPath });
  return destPath;
}

// Inspection-cert photo: same deterministic-naming pattern as gear photos,
// keyed by inspection id rather than gear id.
export async function saveInspectionCertPhoto(sourceUri: string, inspectionId: string): Promise<string> {
  await ensureDir(PHOTOS_DIR);
  const ext = sourceUri.split('.').pop() || 'jpg';
  const destPath = `${PHOTOS_DIR}inspcert_${inspectionId}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destPath });
  return destPath;
}

export async function saveAvatarPhoto(sourceUri: string): Promise<string> {
  await ensureDir(AVATARS_DIR);
  const ext = sourceUri.split('.').pop() || 'jpg';
  const destPath = `${AVATARS_DIR}avatar_${Date.now()}.${ext}`;
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
  const destPath = signRequestPhotoPath(requestId, basename);
  const dir = destPath.slice(0, destPath.lastIndexOf('/') + 1);
  await fs.ensureDir(dir);
  await fs.writeBytes(destPath, bytes);
  return destPath;
}

export async function deleteSignRequestPhotosDir(
  fs: FileSystemAbstraction,
  requestId: string,
): Promise<void> {
  const dir = `${SIGNREQUEST_PHOTOS_DIR}${requestId}/`;
  try { await fs.deletePath(dir); } catch {}
}
