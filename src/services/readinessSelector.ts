import { Profile, Entry } from '../types';

export type ReadinessState = 'ok' | 'warn' | 'err' | 'muted';

export interface ReadinessItem {
  state: ReadinessState;
  label: string;
}

export interface Readiness {
  profileComplete: ReadinessItem;
  signedEntries: ReadinessItem;
  entriesNeedingSignature: ReadinessItem;
  backupRecency: ReadinessItem;
}

export interface ReadinessInputs {
  profile: Profile | null;
  entries: Entry[];
  now: string;
  isSignedIn: boolean;
}

function daysBetween(aIso: string, bIso: string): number {
  return Math.floor((new Date(bIso).getTime() - new Date(aIso).getTime()) / 86_400_000);
}

function profileIsComplete(p: Profile | null): boolean {
  if (!p) return false;
  if (!p.full_name?.trim()) return false;
  if (p.primary_cert === 'sprat') {
    return Boolean(p.sprat_id && p.level && p.cert_expires_on);
  }
  return Boolean(p.irata_id && p.irata_level && p.irata_expires_on);
}

export function computeReadiness({ profile, entries, now, isSignedIn }: ReadinessInputs): Readiness {
  // 1. Profile complete
  const profileComplete: ReadinessItem = profileIsComplete(profile)
    ? { state: 'ok', label: 'Profile complete' }
    : { state: 'warn', label: 'Complete your profile' };

  // 2. Signed entries (signed + amended count toward "lifetime work logged")
  const signedCount = entries.filter((e) => e.status === 'signed' || e.status === 'amended').length;
  const signedEntries: ReadinessItem =
    signedCount === 0
      ? { state: 'muted', label: 'Log and sign your first entry' }
      : { state: 'ok', label: `${signedCount} signed ${signedCount === 1 ? 'entry' : 'entries'}` };

  // 3. Entries needing signature (drafts only — awaiting/sent are still drafts at status level)
  const pendingCount = entries.filter((e) => e.status === 'draft').length;
  const entriesNeedingSignature: ReadinessItem =
    pendingCount === 0
      ? { state: 'ok', label: 'No entries waiting to be signed' }
      : {
          state: 'warn',
          label: `${pendingCount} ${pendingCount === 1 ? 'entry needs' : 'entries need'} signatures`,
        };

  // 4. Backup recency (signed-in branch) / sign-in prompt (signed-out branch)
  let backupRecency: ReadinessItem;
  if (!isSignedIn) {
    backupRecency = { state: 'warn', label: 'Sign in to enable cloud backup' };
  } else {
    const last = profile?.last_cloud_backup_at ?? null;
    if (!last) {
      backupRecency = { state: 'err', label: 'No backups yet — back up now' };
    } else {
      const days = daysBetween(last, now);
      if (days <= 7) {
        backupRecency = {
          state: 'ok',
          label: `Backup ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}`,
        };
      } else if (days <= 30) {
        backupRecency = { state: 'warn', label: `Back up — last sync ${days} days ago` };
      } else {
        backupRecency = { state: 'err', label: `Back up — last sync ${days} days ago` };
      }
    }
  }

  return { profileComplete, signedEntries, entriesNeedingSignature, backupRecency };
}
