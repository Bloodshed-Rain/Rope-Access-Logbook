// src/hooks/useTodayHours.ts
// Selector over useEntries: total work_hours for entries whose
// [date_from, date_to] range includes today.

import { useEntries } from './useEntries';

export function useTodayHours(now: Date = new Date()): number {
  const { data: entries = [] } = useEntries();
  const today = now.toISOString().slice(0, 10);
  return entries
    .filter((e) => e.date_from <= today && today <= e.date_to)
    .reduce((sum, e) => sum + e.work_hours, 0);
}
