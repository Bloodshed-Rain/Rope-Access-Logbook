// src/cloud/fsAbstraction.ts
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';

export interface FileSystemAbstraction {
  readAsBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  deletePath(path: string): Promise<void>;
  ensureDir(path: string): Promise<void>;
  getSha256(path: string): Promise<string>;
  getSize(path: string): Promise<number>;
}

export function createExpoFsAbstraction(): FileSystemAbstraction {
  return {
    async readAsBytes(path: string) {
      const base64 = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
      return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    },
    async writeBytes(path: string, bytes: Uint8Array) {
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
    },
    async exists(path: string) {
      const info = await FileSystem.getInfoAsync(path);
      return info.exists;
    },
    async deletePath(path: string) {
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) await FileSystem.deleteAsync(path, { idempotent: true });
    },
    async ensureDir(path: string) {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) await FileSystem.makeDirectoryAsync(path, { intermediates: true });
    },
    async getSha256(path: string) {
      const base64 = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
      return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64, {
        encoding: Crypto.CryptoEncoding.HEX,
      });
    },
    async getSize(path: string) {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) throw new Error(`File not found: ${path}`);
      return (info as { size?: number }).size ?? 0;
    },
  };
}
