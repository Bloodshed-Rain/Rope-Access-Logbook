// src/utils/entryComplete.ts
// Pure helper: reports whether an entry has every required field filled in
// for signing. Used by the Today screen to count "needs signature" drafts
// and (in C2) by Records-screen filtering.

import { Entry } from '../types';

export function entryRequiredFieldsFilled(e: Entry): boolean {
  return (
    e.site.trim().length > 0 &&
    e.employer.trim().length > 0 &&
    e.work_hours > 0 &&
    e.work_types.length > 0 &&
    !!e.date_from &&
    !!e.date_to
  );
}
