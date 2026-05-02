import type { WorkType } from './types';

export const APP_VERSION = '1.0.0';

// Display labels for the fixed `WorkType` slug set. Hoisted out of
// LogbookScreen so RecordsScreen and other consumers (Today, EntryDetail) can
// share one mapping. Values are the human-readable form used in lists and
// search; the all-caps stencil rendering is left to the caller.
export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  inspection: 'Inspection',
  ndt: 'NDT',
  welding: 'Welding / Fab',
  painting: 'Paint / Coat',
  window_cleaning: 'Window cleaning',
  rescue: 'Rope rescue',
  training: 'Training',
  rigging: 'Rigging',
  other: 'Other',
};
