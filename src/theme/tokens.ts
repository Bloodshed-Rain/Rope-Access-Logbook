// src/theme/tokens.ts
export const colors = {
  background: '#FAFAF8',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  textPrimary: '#1A1A1A',
  textSecondary: '#5C5C5C',
  textTertiary: '#8A8A8A',
  textInverse: '#FFFFFF',
  accent: '#E8601C',
  accentLight: '#FFF0E8',
  slate: '#2D3436',
  slateLight: '#636E72',
  slateLighter: '#B2BEC3',
  slateLightest: '#DFE6E9',
  statusSigned: '#00A676',
  statusSignedLight: '#E6F9F1',
  statusDraft: '#8A8A8A',
  statusDraftLight: '#F0F0F0',
  statusAmended: '#E17055',
  statusAmendedLight: '#FDEEE8',
  warning: '#F9A825',
  warningLight: '#FFF8E1',
  error: '#D63031',
  errorLight: '#FDE8E8',
  border: '#E8E8E8',
  borderFocused: '#E8601C',
  overlay: 'rgba(0, 0, 0, 0.4)',
} as const;

export const spacing = {
  xs: 4, sm: 8, md: 12, base: 16, lg: 24, xl: 32, xxl: 48,
} as const;

export const typography = {
  display: { fontFamily: 'System', fontSize: 32, fontWeight: '700' as const, lineHeight: 40 },
  h1: { fontFamily: 'System', fontSize: 24, fontWeight: '700' as const, lineHeight: 32 },
  h2: { fontFamily: 'System', fontSize: 18, fontWeight: '600' as const, lineHeight: 24 },
  body: { fontFamily: 'System', fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  bodySmall: { fontFamily: 'System', fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  caption: { fontFamily: 'System', fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
} as const;

export const radii = { sm: 6, md: 10, lg: 16, full: 9999 } as const;

export const shadows = {
  sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  md: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
} as const;

export const theme = { colors, spacing, typography, radii, shadows } as const;
export type Theme = typeof theme;
