import { Entry, Signature } from '../types';

interface EntryPageData { entry: Entry; signature: Signature | null; integrityValid: boolean | null; }

export function renderEntryPageHtml({ entry, signature, integrityValid }: EntryPageData): string {
  const amendmentLine = entry.amendment_reason
    ? `<p class="amendment-header">Amendment to entry dated ${entry.date} — reason: ${entry.amendment_reason}</p>` : '';
  const integrityLine = integrityValid === false
    ? '<p class="integrity-fail">INTEGRITY CHECK FAILED — this entry may have been modified after signing.</p>' : '';
  const sigBlock = signature
    ? `<div class="sig-block">
        <h3>Supervisor verification</h3>
        <div class="field"><span class="field-label">Supervisor</span><br/><span class="field-value">${signature.supervisor_name}</span></div>
        <div class="field"><span class="field-label">SPRAT Level III Cert #</span><br/><span class="field-value">${signature.supervisor_cert_number}</span></div>
        <div class="field"><span class="field-label">Signed</span><br/><span class="field-value">${signature.signed_at}</span></div>
        <img class="sig-img" src="${signature.signature_png_path}" />
        <p class="hash">SHA-256: ${signature.entry_hash}</p>
      </div>` : '';

  return `
    <div class="page">
      ${integrityLine}${amendmentLine}
      <h2>${entry.date}</h2>
      <div class="field"><span class="field-label">Site</span><br/><span class="field-value">${entry.site}</span></div>
      <div class="field"><span class="field-label">Employer</span><br/><span class="field-value">${entry.employer}</span></div>
      <div class="field"><span class="field-label">Client</span><br/><span class="field-value">${entry.client}</span></div>
      <div class="field"><span class="field-label">Work hours</span><br/><span class="field-value">${entry.work_hours}</span></div>
      <div class="field"><span class="field-label">Level at time of work</span><br/><span class="field-value">${entry.tech_level_snapshot}</span></div>
      <div class="field"><span class="field-label">Type of work</span><br/><span class="field-value">${entry.work_types.join(', ')}</span></div>
      <div class="field"><span class="field-label">Description</span><br/><span class="field-value">${entry.description}</span></div>
      ${entry.equipment_notes ? `<div class="field"><span class="field-label">Equipment</span><br/><span class="field-value">${entry.equipment_notes}</span></div>` : ''}
      ${entry.weather ? `<div class="field"><span class="field-label">Weather</span><br/><span class="field-value">${entry.weather}</span></div>` : ''}
      ${sigBlock}
    </div>`;
}
