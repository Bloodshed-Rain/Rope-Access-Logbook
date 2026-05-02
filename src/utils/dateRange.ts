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

function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
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
