import { computeReadiness } from '../../src/services/readinessSelector';
import { Profile, Entry } from '../../src/types';

const completeProfile: Profile = {
  id: 'p1',
  full_name: 'Michael Cassidy',
  holds_sprat: true,
  sprat_id: '123456',
  level: 'II',
  cert_expires_on: '2027-06-15',
  sprat_card_photo_path: null,
  holds_irata: false,
  irata_id: null,
  irata_level: null,
  irata_expires_on: null,
  irata_card_photo_path: null,
  primary_cert: 'sprat',
  default_employer: '',
  last_backup_at: null,
  photos_in_backup: false,
  last_cloud_backup_at: '2026-04-25T00:00:00Z',
  last_uploaded_backup_id: null,
  supervisor_capability_enabled: false,
  supervisor_cert_number: null,
  supervisor_directory_visible: true,
  subscription_status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
};

function entry(partial: Partial<Entry>): Entry {
  return {
    id: 'e0',
    date_from: '2026-04-30',
    date_to: '2026-04-30',
    employer: 'ACME',
    site: 'Tower 1',
    client: 'Globex',
    description: 'Inspection',
    work_hours: 4,
    tech_level_snapshot: 'II',
    irata_level_snapshot: null,
    work_types: [],
    other_work_description: null,
    equipment_notes: null,
    weather: null,
    photo_paths: [],
    status: 'draft',
    amends_entry_id: null,
    amendment_reason: null,
    pending_sign_request_id: null,
    created_at: '2026-04-30T00:00:00Z',
    updated_at: '2026-04-30T00:00:00Z',
    ...partial,
  };
}

describe('computeReadiness', () => {
  test('all green when profile complete, signed entries, no pending, fresh backup', () => {
    const r = computeReadiness({
      profile: completeProfile,
      entries: [entry({ id: 'e1', status: 'signed' })],
      now: '2026-04-30T00:00:00Z',
      isSignedIn: true,
    });
    expect(r.profileComplete.state).toBe('ok');
    expect(r.signedEntries.state).toBe('ok');
    expect(r.signedEntries.label).toMatch(/1 signed entry/);
    expect(r.entriesNeedingSignature.state).toBe('ok');
    expect(r.backupRecency.state).toBe('ok');
  });

  test('amber when backup is 8-30 days old', () => {
    const r = computeReadiness({
      profile: { ...completeProfile, last_cloud_backup_at: '2026-04-15T00:00:00Z' },
      entries: [],
      now: '2026-04-30T00:00:00Z',
      isSignedIn: true,
    });
    expect(r.backupRecency.state).toBe('warn');
    expect(r.backupRecency.label).toMatch(/15 days/);
  });

  test('red when backup never', () => {
    const r = computeReadiness({
      profile: { ...completeProfile, last_cloud_backup_at: null },
      entries: [],
      now: '2026-04-30T00:00:00Z',
      isSignedIn: true,
    });
    expect(r.backupRecency.state).toBe('err');
  });

  test('red when backup > 30 days', () => {
    const r = computeReadiness({
      profile: { ...completeProfile, last_cloud_backup_at: '2026-03-01T00:00:00Z' },
      entries: [],
      now: '2026-04-30T00:00:00Z',
      isSignedIn: true,
    });
    expect(r.backupRecency.state).toBe('err');
  });

  test('replaces backup row with sign-in prompt when not signed in', () => {
    const r = computeReadiness({
      profile: completeProfile,
      entries: [],
      now: '2026-04-30T00:00:00Z',
      isSignedIn: false,
    });
    expect(r.backupRecency.label).toMatch(/Sign in to enable cloud backup/);
  });

  test('warns about pending entries needing signature', () => {
    const r = computeReadiness({
      profile: completeProfile,
      entries: [entry({ id: 'a', status: 'draft' }), entry({ id: 'b', status: 'draft' })],
      now: '2026-04-30T00:00:00Z',
      isSignedIn: true,
    });
    expect(r.entriesNeedingSignature.state).toBe('warn');
    expect(r.entriesNeedingSignature.label).toMatch(/2 entries need signatures/);
  });

  test('flags incomplete profile when name missing', () => {
    const r = computeReadiness({
      profile: { ...completeProfile, full_name: '' },
      entries: [],
      now: '2026-04-30T00:00:00Z',
      isSignedIn: true,
    });
    expect(r.profileComplete.state).toBe('warn');
  });

  test('flags incomplete profile when primary IRATA missing', () => {
    const r = computeReadiness({
      profile: { ...completeProfile, primary_cert: 'irata', irata_id: null },
      entries: [],
      now: '2026-04-30T00:00:00Z',
      isSignedIn: true,
    });
    expect(r.profileComplete.state).toBe('warn');
  });

  test('muted gray for zero signed entries', () => {
    const r = computeReadiness({
      profile: completeProfile,
      entries: [],
      now: '2026-04-30T00:00:00Z',
      isSignedIn: true,
    });
    expect(r.signedEntries.state).toBe('muted');
    expect(r.signedEntries.label).toMatch(/Log and sign your first entry/);
  });

  test('counts amended entries as signed', () => {
    const r = computeReadiness({
      profile: completeProfile,
      entries: [entry({ id: 'a', status: 'signed' }), entry({ id: 'b', status: 'amended' })],
      now: '2026-04-30T00:00:00Z',
      isSignedIn: true,
    });
    expect(r.signedEntries.state).toBe('ok');
    expect(r.signedEntries.label).toMatch(/2 signed entries/);
  });

  test('null profile shows incomplete + muted entries + sign-in prompt', () => {
    const r = computeReadiness({
      profile: null,
      entries: [],
      now: '2026-04-30T00:00:00Z',
      isSignedIn: false,
    });
    expect(r.profileComplete.state).toBe('warn');
    expect(r.signedEntries.state).toBe('muted');
    expect(r.backupRecency.label).toMatch(/Sign in/);
  });
});
