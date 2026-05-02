// src/utils/dateRange.ts
// Pretty-print a `YYYY-MM-DD` ISO date range, collapsing repeated parts.
//
//   Same day:               "Apr 21, 2024"
//   Same month, same year:  "Apr 21 – 23, 2024"
//   Cross-month, same year: "Apr 28 – May 2, 2024"
//   Cross-year:             "Dec 28, 2023 – Jan 2, 2024"
//
// Inputs are ISO `YYYY-MM-DD`. We parse with explicit UTC components to avoid
// the local-time-zone shift that `new Date('2024-04-21')` would produce on
// devices west of UTC (which would render an off-by-one day).

const MONTH_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

const FULL_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

// Single-date formatter: `YYYY-MM-DD` → "Mar 15, 2027". Inputs are parsed as
// UTC so devices west of UTC don't render off-by-one — same convention as
// `formatEntryDateRange`.
export function formatDate(iso: string): string {
  return FULL_DATE_FMT.format(parseISODate(iso));
}

function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

// Local-time helpers shared by date-picker UIs (RecordsScreen filter sheet,
// EntryFormScreen wizard step 1). These intentionally use *local* components
// rather than UTC so the picker round-trips a user-selected day without DST
// drift when the device is east/west of UTC.
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISODate(iso: string | null): Date {
  if (!iso) return new Date();
  const [y, m, d] = iso.split('-').map((s) => parseInt(s, 10));
  if (Number.isNaN(y)) return new Date();
  return new Date(y, (m || 1) - 1, d || 1);
}

function fmtMonth(d: Date): string {
  return MONTH_FMT.format(d);
}

export function formatEntryDateRange(from: string, to: string): string {
  const a = parseISODate(from);
  const b = parseISODate(to || from);

  const ay = a.getUTCFullYear();
  const am = a.getUTCMonth();
  const ad = a.getUTCDate();
  const by = b.getUTCFullYear();
  const bm = b.getUTCMonth();
  const bd = b.getUTCDate();

  // Same day
  if (ay === by && am === bm && ad === bd) {
    return `${fmtMonth(a)} ${ad}, ${ay}`;
  }

  // Same month + year
  if (ay === by && am === bm) {
    return `${fmtMonth(a)} ${ad} – ${bd}, ${ay}`;
  }

  // Same year, different months
  if (ay === by) {
    return `${fmtMonth(a)} ${ad} – ${fmtMonth(b)} ${bd}, ${ay}`;
  }

  // Different years
  return `${fmtMonth(a)} ${ad}, ${ay} – ${fmtMonth(b)} ${bd}, ${by}`;
}
