import { Profile, SpratLevel } from '../types';

interface CoverPageData {
  profile: Profile; totalHours: number; hoursByLevel: Record<SpratLevel, number>;
  dateRange: { earliest: string; latest: string }; appVersion: string;
}

export function renderCoverPageHtml({ profile, totalHours, hoursByLevel, dateRange, appVersion }: CoverPageData): string {
  return `
    <div class="page" style="position: relative; min-height: 100vh;">
      <h1>SPRAT Work Experience Logbook</h1><br/>
      <div class="field"><span class="field-label">Technician</span><br/><span class="field-value" style="font-size: 16pt;">${profile.full_name}</span></div>
      <div class="field"><span class="field-label">SPRAT ID</span><br/><span class="field-value">${profile.sprat_id}</span></div>
      <div class="field"><span class="field-label">Current level</span><br/><span class="field-value">Level ${profile.level}</span></div>
      <div class="field"><span class="field-label">Certification expires</span><br/><span class="field-value">${profile.cert_expires_on}</span></div>
      <br/>
      <h3>Work hours summary</h3>
      <table>
        <tr><th>Total</th><td>${totalHours}h</td></tr>
        <tr><th>Level I</th><td>${hoursByLevel.I}h</td></tr>
        <tr><th>Level II</th><td>${hoursByLevel.II}h</td></tr>
        <tr><th>Level III</th><td>${hoursByLevel.III}h</td></tr>
      </table><br/>
      <div class="field"><span class="field-label">Date range</span><br/><span class="field-value">${dateRange.earliest} to ${dateRange.latest}</span></div>
      <div class="field"><span class="field-label">Generated</span><br/><span class="field-value">${new Date().toISOString()}</span></div>
      <div class="cover-footer">
        Digitally generated from Rope Access Logbook v${appVersion}. Entries are tamper-evident: each signed entry carries a SHA-256 content hash that can be verified against the exported JSON backup.
      </div>
    </div>`;
}
