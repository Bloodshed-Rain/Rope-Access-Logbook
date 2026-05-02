// src/screens/entryForm/types.ts
// Shared types for the EntryForm wizard split across Step1 / Step2 files.

import { WorkType } from '../../types';

export type WizardStep = 1 | 2;
export type WhenChoice = 'today' | 'yesterday' | 'custom';

export interface WizardState {
  // Step 1.
  site: string;
  employer: string;
  dateFrom: string;
  dateTo: string;
  when: WhenChoice;
  workHours: string;
  // Step 2.
  workTypes: WorkType[];
  otherWorkDescription: string;
  notes: string;
  // Amend-only.
  amendmentReason: string;
  // Preserved-but-hidden fields (edit/amend pass-through).
  client: string;
  equipmentNotes: string;
  weather: string;
  photoPaths: string[];
}

export type WizardStateUpdate = <K extends keyof WizardState>(
  key: K,
  value: WizardState[K],
) => void;
