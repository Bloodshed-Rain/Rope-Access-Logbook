import { Entry, HashFn } from '../types';
import { canonicalize } from './canonical';
import { normalizeAppPath } from './paths';

/**
 * Hash an Entry payload (as sent in a sign request) using v3 algorithm.
 * Mirrors signingService.entryRowToHashInputV3 but operates on an Entry
 * object rather than a DB row. Used by signRequestsService when producing
 * and verifying the server-side snapshot hash.
 *
 * The shape below must stay byte-identical to entryRowToHashInputV3.
 *
 * Key details:
 *
 * - The row's `work_types` is a JSON string column, so v3 feeds the raw
 *   string to canonicalize. We JSON.stringify the entry.work_types array
 *   here to reproduce that exact string (no spaces, matching JSON.stringify
 *   output used in entriesService).
 *
 * - `status` is FORCED to 'signed' regardless of what the payload carries.
 *   The payload is snapshotted from a draft entry at send-time, so
 *   `entry.status` is 'draft', but by the time the tech's local
 *   `verifyIntegrity` runs the row has already been flipped to 'signed'
 *   by `applyIncomingSignature`. Hashing 'signed' on both sides keeps
 *   the cross-check consistent. This matches the intent of the hash:
 *   it attests to the signed content, not to the in-flight draft state.
 */
export async function computeEntryHashFromPayload(
  entry: Entry,
  hash: HashFn,
  version: number = 3,
): Promise<string> {
  if (version !== 3) {
    throw new Error(`Unsupported hash_version for payload: ${version}`);
  }
  const normalizedPaths = entry.photo_paths.map(normalizeAppPath);
  const input = {
    id: entry.id,
    date_from: entry.date_from,
    date_to: entry.date_to,
    employer: entry.employer,
    site: entry.site,
    client: entry.client,
    description: entry.description,
    work_hours: entry.work_hours,
    tech_level_snapshot: entry.tech_level_snapshot,
    work_types: JSON.stringify(entry.work_types),
    other_work_description: entry.other_work_description,
    equipment_notes: entry.equipment_notes,
    weather: entry.weather,
    photo_paths: normalizedPaths,
    status: 'signed',
    amends_entry_id: entry.amends_entry_id,
    amendment_reason: entry.amendment_reason,
  };
  return hash(canonicalize(input));
}
