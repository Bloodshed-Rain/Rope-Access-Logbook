// src/theme/tokens.ts
// SPRAT / industrial rope access color palette

export const colors = {
  // Surfaces
  background: '#F2F2F2',       // Concrete Light
  surface: '#FFFFFF',           // White cards
  surfaceElevated: '#FFFFFF',

  // Text — high contrast for outdoor readability
  textPrimary: '#1A1A1A',
  textSecondary: '#4A4A4A',     // Steel Gray
  textTertiary: '#717171',
  textInverse: '#FFFFFF',

  // Brand
  accent: '#FF6600',            // Safety Orange — primary CTA
  accentLight: '#FFF0E0',
  navy: '#003366',              // SPRAT Blue — headers, nav chrome
  navyLight: '#E6EDF5',
  ropeTan: '#C4A35A',           // Rope Tan — subtle accent

  // Chrome
  slate: '#4A4A4A',             // Steel Gray
  slateLight: '#636E72',
  slateLighter: '#B2BEC3',
  slateLightest: '#E0E0E0',

  // Status
  statusSigned: '#1B8A5A',      // Forest green — high contrast
  statusSignedLight: '#E2F5EC',
  statusDraft: '#717171',
  statusDraftLight: '#EFEFEF',
  statusAmended: '#C8102E',     // IRATA Red
  statusAmendedLight: '#FCE8EB',

  // Semantic
  warning: '#E6930A',
  warningLight: '#FFF4E0',
  error: '#C8102E',             // IRATA Red
  errorLight: '#FCE8EB',

  // Borders
  border: '#D4D4D4',
  borderFocused: '#FF6600',     // Safety Orange focus ring

  overlay: 'rgba(0, 0, 0, 0.5)',
} as const;

export const spacing = {
  xs: 4, sm: 8, md: 12, base: 16, lg: 24, xl: 32, xxl: 48,
} as const;

// Glove-friendly: minimum touch targets 48px, prefer 56px
export const touchTarget = {
  min: 48,
  preferred: 56,
} as const;

export const typography = {
  display: { fontFamily: 'System', fontSize: 32, fontWeight: '800' as const, lineHeight: 40 },
  h1: { fontFamily: 'System', fontSize: 24, fontWeight: '700' as const, lineHeight: 32 },
  h2: { fontFamily: 'System', fontSize: 18, fontWeight: '700' as const, lineHeight: 24 },
  body: { fontFamily: 'System', fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  bodyBold: { fontFamily: 'System', fontSize: 16, fontWeight: '600' as const, lineHeight: 24 },
  bodySmall: { fontFamily: 'System', fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  caption: { fontFamily: 'System', fontSize: 12, fontWeight: '500' as const, lineHeight: 16 },
  mono: { fontFamily: 'monospace', fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
} as const;

export const radii = { sm: 6, md: 10, lg: 14, full: 9999 } as const;

export const shadows = {
  sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  md: { shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 4 },
} as const;

export const theme = { colors, spacing, typography, radii, shadows, touchTarget } as const;
export type Theme = typeof theme;
