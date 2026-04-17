import { DbClient } from './client';
import { HashFn, Signature } from '../types';
import { createSigningService } from '../services/signingService';

export async function runHashMigration(db: DbClient, hashFn: HashFn): Promise<void> {
  const signing = createSigningService(db, hashFn);
  const rows = await db.getAll<Signature>(
    'SELECT * FROM signatures WHERE hash_version IS NULL OR hash_version = 1',
  );
  for (const sig of rows) {
    const v1Hash = await signing.computeEntryHashForVersion(sig.entry_id, 1);
    if (v1Hash !== sig.entry_hash) {
      // v1 verification fails on this device — do not migrate, leave flagged as tampered.
      continue;
    }
    const v2Hash = await signing.computeEntryHashForVersion(sig.entry_id, 2);
    await db.run(
      'UPDATE signatures SET entry_hash = ?, hash_version = 2 WHERE id = ?',
      [v2Hash, sig.id],
    );
  }
}
