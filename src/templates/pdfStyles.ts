export const pdfStyles = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1A1A1A; font-size: 11pt; line-height: 1.5; }
  .page { padding: 48px; page-break-after: always; }
  .page:last-child { page-break-after: avoid; }
  h1 { font-family: Georgia, 'Times New Roman', serif; font-size: 22pt; font-weight: 700; margin-bottom: 8px; }
  h2 { font-family: Georgia, 'Times New Roman', serif; font-size: 14pt; font-weight: 600; margin-bottom: 4px; color: #2D3436; }
  h3 { font-size: 11pt; font-weight: 600; margin-bottom: 4px; }
  .meta { font-size: 9pt; color: #5C5C5C; }
  .field { margin-bottom: 6px; }
  .field-label { font-size: 9pt; color: #8A8A8A; text-transform: uppercase; letter-spacing: 0.5px; }
  .field-value { font-size: 11pt; }
  .sig-block { border-top: 1px solid #E8E8E8; margin-top: 24px; padding-top: 16px; }
  .sig-img { max-width: 200px; height: 60px; object-fit: contain; }
  .hash { font-family: 'Courier New', monospace; font-size: 8pt; color: #8A8A8A; margin-top: 12px; word-break: break-all; }
  .amendment-header { color: #E17055; font-style: italic; margin-bottom: 8px; }
  .integrity-fail { color: #D63031; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #DFE6E9; padding: 6px 10px; text-align: left; font-size: 10pt; }
  th { background-color: #F0F0F0; font-weight: 600; }
  .cover-footer { position: absolute; bottom: 48px; left: 48px; right: 48px; font-size: 8pt; color: #8A8A8A; border-top: 1px solid #E8E8E8; padding-top: 8px; }
`;
