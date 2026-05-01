import { createTestClient } from '../setup';
import { createCertProgressService } from '../../src/services/certProgressService';
import { Profile, CertScheme } from '../../src/types';

function profileFactory(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    full_name: 'Tech',
    holds_sprat: true,
    sprat_id: 'S1',
    level: 'I',
    cert_expires_on: '2027-01-01',
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
    last_cloud_backup_at: null,
    last_uploaded_backup_id: null,
    supervisor_capability_enabled: false,
    supervisor_cert_number: null,
    supervisor_directory_visible: false,
    subscription_status: 'unknown',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

async function insertEntry(
  db: Awaited<ReturnType<typeof createTestClient>>,
  opts: {
    id: string;
    date: string;            // YYYY-MM-DD
    hours: number;
    sprat?: 'I' | 'II' | 'III' | null;
    irata?: 'I' | 'II' | 'III' | null;
    status?: 'draft' | 'signed' | 'amended';
    workTypes?: string[];
    site?: string;
  },
) {
  await db.run(
    `INSERT INTO entries (id, date, date_from, date_to, employer, site, client, description, work_hours,
      tech_level_snapshot, irata_level_snapshot, work_types, photo_paths, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.date,
      opts.date,
      opts.date,
      'Acme',
      opts.site ?? 'Site',
      'Client',
      'Work',
      opts.hours,
      opts.sprat ?? 'I',
      opts.irata ?? null,
      JSON.stringify(opts.workTypes ?? []),
      '[]',
      opts.status ?? 'signed',
      opts.date + 'T00:00:00Z',
      opts.date + 'T00:00:00Z',
    ],
  );
}

describe('certProgressService', () => {
  describe('thresholds', () => {
    it('exposes per-scheme threshold table', async () => {
      const db = await createTestClient();
      const svc = createCertProgressService(db);
      expect(svc.HOURS_THRESHOLDS.irata).toEqual({ I: 1000, II: 1000, III: null });
      expect(svc.HOURS_THRESHOLDS.sprat).toEqual({ I: 500, II: 500, III: null });
    });
  });

  describe('getCertProgress', () => {
    it('returns null when scheme is not held', async () => {
      const db = await createTestClient();
      const svc = createCertProgressService(db);
      const profile = profileFactory({ holds_irata: false });
      expect(await svc.getCertProgress('irata', profile)).toBeNull();
    });

    it('returns max-level for L3 holders', async () => {
      const db = await createTestClient();
      const svc = createCertProgressService(db);
      const profile = profileFactory({ level: 'III' });
      const p = await svc.getCertProgress('sprat', profile);
      expect(p).toMatchObject({
        scheme: 'sprat',
        currentLevel: 'III',
        isMaxLevel: true,
        target: null,
        remaining: 0,
        isEligible: false,
        projection: { kind: 'max-level' },
      });
    });

    it('filters hours by status (drafts excluded)', async () => {
      const db = await createTestClient();
      const today = new Date('2026-12-01');
      const svc = createCertProgressService(db, () => today);
      await insertEntry(db, { id: 'e1', date: '2026-06-01', hours: 100, sprat: 'I', status: 'signed' });
      await insertEntry(db, { id: 'e2', date: '2026-06-02', hours: 200, sprat: 'I', status: 'draft' });
      await insertEntry(db, { id: 'e3', date: '2026-06-03', hours: 50, sprat: 'I', status: 'amended' });

      const profile = profileFactory({ level: 'I' });
      const p = await svc.getCertProgress('sprat', profile);
      // 100 (signed) + 50 (amended) = 150. Draft excluded.
      expect(p?.hoursAtLevel).toBe(150);
      expect(p?.target).toBe(500);
      expect(p?.remaining).toBe(350);
      expect(p?.isEligible).toBe(false);
    });

    it('returns eligible-now when hours-at-level reaches target', async () => {
      const db = await createTestClient();
      const today = new Date('2026-12-01');
      const svc = createCertProgressService(db, () => today);
      await insertEntry(db, { id: 'e1', date: '2026-06-01', hours: 500, sprat: 'I', status: 'signed' });
      const profile = profileFactory({ level: 'I' });
      const p = await svc.getCertProgress('sprat', profile);
      expect(p?.isEligible).toBe(true);
      expect(p?.projection).toEqual({ kind: 'eligible-now' });
    });

    it('returns insufficient-data when fewer than 30 days of history at current level', async () => {
      const db = await createTestClient();
      const today = new Date('2026-06-15');
      const svc = createCertProgressService(db, () => today);
      // Earliest entry is just 10 days old
      await insertEntry(db, { id: 'e1', date: '2026-06-05', hours: 50, sprat: 'I', status: 'signed' });
      const profile = profileFactory({ level: 'I' });
      const p = await svc.getCertProgress('sprat', profile);
      expect(p?.projection).toEqual({ kind: 'insufficient-data' });
    });

    it('returns paused when 30+ days history but zero recent hours', async () => {
      const db = await createTestClient();
      const today = new Date('2026-12-01');
      const svc = createCertProgressService(db, () => today);
      // Old entry 8 months ago — sets up history. No entries in last 90 days.
      await insertEntry(db, { id: 'e1', date: '2026-04-01', hours: 100, sprat: 'I', status: 'signed' });
      const profile = profileFactory({ level: 'I' });
      const p = await svc.getCertProgress('sprat', profile);
      expect(p?.projection).toEqual({ kind: 'paused' });
    });

    it('returns projected eligibility from 90-day moving average', async () => {
      const db = await createTestClient();
      const today = new Date('2026-12-01');
      const svc = createCertProgressService(db, () => today);
      // Old entry to satisfy history gate
      await insertEntry(db, { id: 'e_old', date: '2026-04-01', hours: 50, sprat: 'I', status: 'signed' });
      // Recent entry within 90-day window: 90 hours over 90 days = 1 hour/day
      await insertEntry(db, { id: 'e1', date: '2026-10-01', hours: 90, sprat: 'I', status: 'signed' });
      const profile = profileFactory({ level: 'I' });
      const p = await svc.getCertProgress('sprat', profile);
      expect(p?.projection.kind).toBe('projected');
      if (p?.projection.kind === 'projected') {
        expect(p.projection.hoursPerDay).toBeCloseTo(1, 5);
        // 500 - 140 = 360 hours remaining at 1h/day → 360 days out
        expect(p.projection.daysOut).toBe(360);
      }
    });

    it('IRATA progress is independent of SPRAT entries', async () => {
      const db = await createTestClient();
      const today = new Date('2026-12-01');
      const svc = createCertProgressService(db, () => today);
      // Entry with both snapshots set — counts toward both.
      await insertEntry(db, {
        id: 'e1',
        date: '2026-06-01',
        hours: 100,
        sprat: 'I',
        irata: 'I',
        status: 'signed',
      });
      // Entry with only SPRAT — counts toward SPRAT only.
      await insertEntry(db, {
        id: 'e2',
        date: '2026-06-02',
        hours: 50,
        sprat: 'I',
        irata: null,
        status: 'signed',
      });
      const profile = profileFactory({
        holds_sprat: true,
        level: 'I',
        holds_irata: true,
        irata_id: 'I-1',
        irata_level: 'I',
        irata_expires_on: '2027-01-01',
      });
      const sprat = await svc.getCertProgress('sprat', profile);
      const irata = await svc.getCertProgress('irata', profile);
      expect(sprat?.hoursAtLevel).toBe(150);
      expect(irata?.hoursAtLevel).toBe(100);
    });
  });

  describe('getRecert', () => {
    it('returns null when scheme is not held', async () => {
      const db = await createTestClient();
      const svc = createCertProgressService(db, () => new Date('2026-04-25'));
      const profile = profileFactory({ holds_irata: false });
      expect(svc.getRecert('irata', profile)).toBeNull();
    });

    it.each<[string, number, 'safe' | 'reval-open' | 'expires-today' | 'expired']>([
      // [today, daysToExpiry, expected state]
      ['2026-04-25', 365, 'safe'],
      ['2026-04-25', 181, 'safe'],
      ['2026-04-25', 180, 'reval-open'],
      ['2026-04-25', 1, 'reval-open'],
      ['2026-04-25', 0, 'expires-today'],
      ['2026-04-25', -1, 'expired'],
    ])('today=%s, daysToExpiry=%i → %s', async (today, days, expected) => {
      const db = await createTestClient();
      const todayDate = new Date(today + 'T12:00:00Z');
      const expiry = new Date(todayDate.getTime() + days * 24 * 60 * 60 * 1000);
      const yyyymmdd = expiry.toISOString().substring(0, 10);
      const svc = createCertProgressService(db, () => todayDate);
      const profile = profileFactory({ cert_expires_on: yyyymmdd });
      const r = svc.getRecert('sprat', profile);
      expect(r?.state).toBe(expected);
      expect(r?.daysToExpiry).toBe(days);
    });
  });

  describe('getDashboardStats', () => {
    it('aggregates lifetime / year / last-year hours and counts jobs + sites', async () => {
      const db = await createTestClient();
      const svc = createCertProgressService(db);
      await insertEntry(db, { id: 'e1', date: '2026-06-01', hours: 8, sprat: 'I', site: 'Site A' });
      await insertEntry(db, { id: 'e2', date: '2026-06-02', hours: 4, sprat: 'I', site: 'Site B' });
      await insertEntry(db, { id: 'e3', date: '2025-09-15', hours: 10, sprat: 'I', site: 'Site A' });
      await insertEntry(db, { id: 'e4', date: '2026-06-03', hours: 3, sprat: 'I', site: 'Site A', status: 'draft' });
      const stats = await svc.getDashboardStats(2026);
      expect(stats.lifetimeHours).toBe(22); // 8 + 4 + 10 (draft excluded)
      expect(stats.thisYearHours).toBe(12); // 8 + 4
      expect(stats.lastYearHours).toBe(10); // 10
      expect(stats.yoyDelta).toBe(2);
      expect(stats.totalJobs).toBe(3); // signed/amended only
      expect(stats.totalSites).toBe(2); // Site A + Site B
    });
  });

  describe('getWorkBreakdown', () => {
    it('tallies multi-work-type entries against each type, sorts desc, drops zeros', async () => {
      const db = await createTestClient();
      const svc = createCertProgressService(db);
      await insertEntry(db, {
        id: 'e1', date: '2026-06-01', hours: 8, sprat: 'I',
        workTypes: ['inspection', 'ndt'],
      });
      await insertEntry(db, {
        id: 'e2', date: '2026-06-02', hours: 4, sprat: 'I',
        workTypes: ['inspection'],
      });
      await insertEntry(db, {
        id: 'e3', date: '2026-06-03', hours: 6, sprat: 'I',
        workTypes: ['rescue'],
      });
      const b = await svc.getWorkBreakdown(2026);
      expect(b.items).toEqual([
        { workType: 'inspection', hours: 12 },
        { workType: 'ndt', hours: 8 },
        { workType: 'rescue', hours: 6 },
      ]);
      expect(b.maxHours).toBe(12);
    });

    it('returns empty when no signed entries in year', async () => {
      const db = await createTestClient();
      const svc = createCertProgressService(db);
      await insertEntry(db, {
        id: 'e1', date: '2025-06-01', hours: 8, sprat: 'I',
        workTypes: ['inspection'],
      });
      const b = await svc.getWorkBreakdown(2026);
      expect(b.items).toEqual([]);
      expect(b.maxHours).toBe(0);
    });
  });
});
