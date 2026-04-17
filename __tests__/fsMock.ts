// __tests__/fsMock.ts
import { createHash } from 'crypto';
import { FileSystemAbstraction } from '../src/cloud/fsAbstraction';

export interface MockFs extends FileSystemAbstraction {
  readonly files: Map<string, Uint8Array>;
  writeStringSync(path: string, text: string): void;
}

export function createMockFs(): MockFs {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    writeStringSync(path, text) {
      files.set(path, new TextEncoder().encode(text));
    },
    async readAsBytes(path) {
      const b = files.get(path);
      if (!b) throw new Error(`File not found: ${path}`);
      return b;
    },
    async writeBytes(path, bytes) { files.set(path, bytes); },
    async exists(path) { return files.has(path); },
    async deletePath(path) { files.delete(path); },
    async ensureDir(_path) { /* no-op */ },
    async getSha256(path) {
      const b = files.get(path);
      if (!b) throw new Error(`File not found: ${path}`);
      return createHash('sha256').update(Buffer.from(b)).digest('hex');
    },
    async getSize(path) {
      const b = files.get(path);
      if (!b) throw new Error(`File not found: ${path}`);
      return b.length;
    },
  };
}
