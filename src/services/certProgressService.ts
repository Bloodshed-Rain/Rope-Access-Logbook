// src/services/certProgressService.ts
// Per-scheme cert progression math: hours-at-current-level, projected eligibility,
// recert countdown. Pure functions over a DbClient + injected `today` clock.

import { DbClient } from '../db/client';
import {
  CertLevel,
  CertScheme,
  Profile,
  WorkType,
} from '../types';

export const HOURS_THRESHOLDS: Record<CertScheme, Record<CertLevel, number | null>> = {
  irata: { I: 1000, II: 1000, III: null },
  sprat: { I: 500, II: 500, III: null },
};

export type Projection =
  | { kind: 'eligible-now' }
  | { kind: 'projected'; date: Date; daysOut: number; hoursPerDay: number }
  | { kind: 'insufficient-data' }
  | { kind: 'paused' }
  | { kind: 'max-level' };

export interface CertProgress {
  scheme: CertScheme;
  currentLevel: CertLevel;
  isMaxLevel: boolean;
  target: number | null;
  hoursAtLevel: number;
  remaining: number;
  isEligible: boolean;
  projection: Projection;
}

export type RecertState = 'safe' | 'reval-open' | 'expires-today' | 'expired';

export interface RecertStatus {
  scheme: CertScheme;
  expiresOn: string;
  daysToExpiry: number;
  state: RecertState;
}

export interface DashboardStats {
  lifetimeHours: number;
  thisYearHours: number;
  lastYearHours: number;
  yoyDelta: number;
  totalJobs: number;
  totalSites: number;
}

export interface WorkBreakdownItem {
  workType: WorkType;
  hours: number;
}

export interface WorkBreakdown {
  items: WorkBreakdownItem[];
  maxHours: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const REVAL_WINDOW_DAYS = 180;
const PROJECTION_WINDOW_DAYS = 90;
const MIN_HISTORY_DAYS = 30;

function parseDate(yyyymmdd: string): Date {
  // Treat dates as UTC midnight to avoid TZ-induced day-boundary surprises.
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

function fmtDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfYear(year: number): string {
  return `${year}-01-01`;
}

function startOfNextYear(year: number): string {
  return `${year + 1}-01-01`;
}

export function createCertProgressService(db: DbClient, todayFn: () => Date = () => new Date()) {
  // Sums work_hours where the entry's level snapshot for the given scheme matches
  // `level`, and the entry is signed (or amended). Drafts and pending-signature
  // entries don't count toward progression.
  async function getHoursAtLevel(scheme: CertScheme, level: CertLevel): Promise<number> {
    const col = scheme === 'sprat' ? 'tech_level_snapshot' : 'irata_level_snapshot';
    // Skip originals superseded by a signed amendment so the level total
    // doesn't count both the original and its correction.
    const row = await db.get<{ total: number | null }>(
      `SELECT SUM(work_hours) as total FROM entries e
        WHERE ${col} = ? AND status IN ('signed', 'amended')
          AND NOT EXISTS (
            SELECT 1 FROM entries a WHERE a.amends_entry_id = e.id AND a.status = 'signed'
          )`,
      [level],
    );
    return row?.total ?? 0;
  }

  async function projectEligibility(
    scheme: CertScheme,
    currentLevel: CertLevel,
    hoursAtLevel: number,
    target: number | null,
    today: Date,
  ): Promise<Projection> {
    if (target === null) return { kind: 'max-level' };
    if (hoursAtLevel >= target) return { kind: 'eligible-now' };
    const col = scheme === 'sprat' ? 'tech_level_snapshot' : 'irata_level_snapshot';

    // 30-day history gate: if oldest entry at current level is too recent, the
    // moving-average projection would whip from a tiny sample.
    const oldest = await db.get<{ d: string | null }>(
      `SELECT MIN(date_from) as d FROM entries e
        WHERE ${col} = ? AND status IN ('signed', 'amended')
          AND NOT EXISTS (
            SELECT 1 FROM entries a WHERE a.amends_entry_id = e.id AND a.status = 'signed'
          )`,
      [currentLevel],
    );
    if (!oldest?.d) return { kind: 'insufficient-data' };
    const daysOfHistory = Math.floor((today.getTime() - parseDate(oldest.d).getTime()) / DAY_MS);
    if (daysOfHistory < MIN_HISTORY_DAYS) return { kind: 'insufficient-data' };

    // 90-day moving average of hours at the current level.
    const ninetyDaysAgo = new Date(today.getTime() - PROJECTION_WINDOW_DAYS * DAY_MS);
    const recent = await db.get<{ total: number | null }>(
      `SELECT SUM(work_hours) as total FROM entries e
       WHERE ${col} = ? AND status IN ('signed', 'amended') AND date_from >= ?
         AND NOT EXISTS (
           SELECT 1 FROM entries a WHERE a.amends_entry_id = e.id AND a.status = 'signed'
         )`,
      [currentLevel, fmtDate(ninetyDaysAgo)],
    );
    const recentHours = recent?.total ?? 0;
    const hoursPerDay = recentHours / PROJECTION_WINDOW_DAYS;
    if (hoursPerDay === 0) return { kind: 'paused' };

    const remaining = target - hoursAtLevel;
    const daysOut = Math.ceil(remaining / hoursPerDay);
    const date = new Date(today.getTime() + daysOut * DAY_MS);
    return { kind: 'projected', date, daysOut, hoursPerDay };
  }

  return {
    HOURS_THRESHOLDS,

    async getCertProgress(scheme: CertScheme, profile: Profile): Promise<CertProgress | null> {
      const heldFlag = scheme === 'irata' ? profile.holds_irata : profile.holds_sprat;
      if (!heldFlag) return null;
      const currentLevel: CertLevel | null =
        scheme === 'irata' ? profile.irata_level : profile.level;
      if (!currentLevel) return null;
      const target = HOURS_THRESHOLDS[scheme][currentLevel];
      const hoursAtLevel = await getHoursAtLevel(scheme, currentLevel);
      const isMaxLevel = target === null;
      const remaining = target === null ? 0 : Math.max(0, target - hoursAtLevel);
      const isEligible = target !== null && hoursAtLevel >= target;
      const today = todayFn();
      const projection = await projectEligibility(scheme, currentLevel, hoursAtLevel, target, today);
      return {
        scheme,
        currentLevel,
        isMaxLevel,
        target,
        hoursAtLevel,
        remaining,
        isEligible,
        projection,
      };
    },

    getRecert(scheme: CertScheme, profile: Profile): RecertStatus | null {
      const expiresOn = scheme === 'irata' ? profile.irata_expires_on : profile.cert_expires_on;
      const heldFlag = scheme === 'irata' ? profile.holds_irata : profile.holds_sprat;
      if (!heldFlag || !expiresOn) return null;
      const today = todayFn();
      // Compare in UTC days to avoid sub-day shifts.
      const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const expiry = parseDate(expiresOn);
      const daysToExpiry = Math.floor((expiry.getTime() - todayUtc.getTime()) / DAY_MS);
      let state: RecertState;
      if (daysToExpiry < 0) state = 'expired';
      else if (daysToExpiry === 0) state = 'expires-today';
      else if (daysToExpiry <= REVAL_WINDOW_DAYS) state = 'reval-open';
      else state = 'safe';
      return { scheme, expiresOn, daysToExpiry, state };
    },

    async getDashboardStats(year: number): Promise<DashboardStats> {
      // Supersedence rule (same as entriesService): exclude an original
      // entry from sums + counts when it has a signed amendment, otherwise
      // hours and job counts double-count the original alongside its
      // correction. The amendment itself still counts via its own row.
      const NOT_SUPERSEDED = `NOT EXISTS (
        SELECT 1 FROM entries a
         WHERE a.amends_entry_id = e.id AND a.status = 'signed'
      )`;
      const lifetime = await db.get<{ total: number | null }>(
        `SELECT SUM(work_hours) as total FROM entries e
          WHERE status IN ('signed', 'amended') AND ${NOT_SUPERSEDED}`,
      );
      const thisYear = await db.get<{ total: number | null }>(
        `SELECT SUM(work_hours) as total FROM entries e
         WHERE status IN ('signed', 'amended') AND date_from >= ? AND date_from < ?
           AND ${NOT_SUPERSEDED}`,
        [startOfYear(year), startOfNextYear(year)],
      );
      const lastYear = await db.get<{ total: number | null }>(
        `SELECT SUM(work_hours) as total FROM entries e
         WHERE status IN ('signed', 'amended') AND date_from >= ? AND date_from < ?
           AND ${NOT_SUPERSEDED}`,
        [startOfYear(year - 1), startOfYear(year)],
      );
      const jobs = await db.get<{ c: number }>(
        `SELECT COUNT(*) as c FROM entries e
          WHERE status IN ('signed', 'amended') AND ${NOT_SUPERSEDED}`,
      );
      const sites = await db.get<{ c: number }>(
        `SELECT COUNT(DISTINCT site) as c FROM entries e
          WHERE status IN ('signed', 'amended') AND site != '' AND ${NOT_SUPERSEDED}`,
      );
      const lifetimeHours = lifetime?.total ?? 0;
      const thisYearHours = thisYear?.total ?? 0;
      const lastYearHours = lastYear?.total ?? 0;
      return {
        lifetimeHours,
        thisYearHours,
        lastYearHours,
        yoyDelta: thisYearHours - lastYearHours,
        totalJobs: jobs?.c ?? 0,
        totalSites: sites?.c ?? 0,
      };
    },

    async getWorkBreakdown(year: number): Promise<WorkBreakdown> {
      // Same supersedence rule as the totals queries — drop originals that
      // have a signed amendment so the breakdown reflects current truth.
      const rows = await db.getAll<{ work_types: string; work_hours: number }>(
        `SELECT work_types, work_hours FROM entries e
         WHERE status IN ('signed', 'amended') AND date_from >= ? AND date_from < ?
           AND NOT EXISTS (
             SELECT 1 FROM entries a WHERE a.amends_entry_id = e.id AND a.status = 'signed'
           )`,
        [startOfYear(year), startOfNextYear(year)],
      );
      // Multi-work-type entries' hours count toward each type — intentional double
      // counting for the breakdown (matches how techs think about it).
      const tally = new Map<WorkType, number>();
      for (const r of rows) {
        let parsed: WorkType[];
        try {
          parsed = JSON.parse(r.work_types) as WorkType[];
        } catch {
          parsed = [];
        }
        for (const t of parsed) tally.set(t, (tally.get(t) ?? 0) + r.work_hours);
      }
      const items: WorkBreakdownItem[] = [...tally.entries()]
        .map(([workType, hours]) => ({ workType, hours }))
        .filter((i) => i.hours > 0)
        .sort((a, b) => b.hours - a.hours);
      const maxHours = items.length > 0 ? items[0].hours : 0;
      return { items, maxHours };
    },
  };
}
