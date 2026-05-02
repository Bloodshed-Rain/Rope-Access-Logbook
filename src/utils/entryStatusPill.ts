// src/utils/entryStatusPill.ts
// Shared classifier + pill spec used by RecordsScreen rows and
// EntryDetailScreen's header. Single source of truth for the
// chip/pill mapping defined in spec §5 + §7.

import { Entry, SignRequestStatus } from '../types';
import { entryRequiredFieldsFilled } from './entryComplete';

export type EntryClassification =
  | 'all'
  | 'drafts'
  | 'needs_signature'
  | 'awaiting'
  | 'signed';

export function classifyEntry(e: Entry): EntryClassification {
  if (e.status === 'signed' || e.status === 'amended') return 'signed';
  // status === 'draft'
  if (e.pending_sign_request_id) return 'awaiting';
  if (entryRequiredFieldsFilled(e)) return 'needs_signature';
  return 'drafts';
}

export interface PillSpec {
  variant: 'pending' | 'signed' | 'amended';
  label: string;
}

export function pillFor(e: Entry, classification: EntryClassification): PillSpec {
  if (e.status === 'amended') return { variant: 'amended', label: 'Amended' };
  if (e.status === 'signed') return { variant: 'signed', label: 'Signed' };
  if (classification === 'awaiting') return { variant: 'pending', label: 'Awaiting' };
  if (classification === 'needs_signature') return { variant: 'pending', label: 'Needs signature' };
  return { variant: 'pending', label: 'Draft' };
}

// Sign-request status → pill spec. Used by InboxScreen rows and
// SignRequestDetailScreen header. Pending stays warn-orange; signed is
// green; declined/withdrawn/expired collapse to gray (no separate "danger"
// variant — these are expected terminal states for a request, not errors).
export function pillForSignRequest(status: SignRequestStatus): PillSpec {
  if (status === 'signed') return { variant: 'signed', label: 'Signed' };
  if (status === 'pending') return { variant: 'pending', label: 'Pending' };
  if (status === 'declined') return { variant: 'amended', label: 'Declined' };
  if (status === 'withdrawn') return { variant: 'amended', label: 'Withdrawn' };
  return { variant: 'amended', label: 'Expired' };
}
