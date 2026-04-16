export function renderSummaryPageHtml({ hoursByYear, hoursByWorkType, amendments }: {
  hoursByYear: Record<number, number>; hoursByWorkType: Record<string, number>;
  amendments: { originalDate: string; amendmentDate: string; reason: string }[];
}): string {
  const yearRows = Object.entries(hoursByYear).sort(([a], [b]) => Number(a) - Number(b))
    .map(([year, hours]) => `<tr><td>${year}</td><td>${hours}h</td></tr>`).join('');
  const typeRows = Object.entries(hoursByWorkType).sort(([, a], [, b]) => b - a)
    .map(([type, hours]) => `<tr><td>${type}</td><td>${hours}h</td></tr>`).join('');
  const amendRows = amendments.length > 0
    ? amendments.map((a) => `<tr><td>${a.originalDate}</td><td>${a.amendmentDate}</td><td>${a.reason}</td></tr>`).join('')
    : '<tr><td colspan="3">No amendments</td></tr>';

  return `
    <div class="page">
      <h2>Summary</h2>
      <h3>Hours by year</h3>
      <table><tr><th>Year</th><th>Hours</th></tr>${yearRows}</table>
      <h3 style="margin-top: 24px;">Hours by work type</h3>
      <table><tr><th>Type</th><th>Hours</th></tr>${typeRows}</table>
      <h3 style="margin-top: 24px;">Amendment log</h3>
      <table><tr><th>Original date</th><th>Amendment date</th><th>Reason</th></tr>${amendRows}</table>
    </div>`;
}
