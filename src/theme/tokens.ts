// src/theme/tokens.ts
// Cream & Blood Design System

export const colors = {
  // New Cream & Blood tokens
  bg: '#F0E8D4',
  bg2: '#E6DCC2',
  paper: '#FBF6E8',
  ink: '#1A1510',
  ink70: 'rgba(26,21,16,0.70)',
  ink50: 'rgba(26,21,16,0.50)',
  ink30: 'rgba(26,21,16,0.30)',
  ink15: 'rgba(26,21,16,0.15)',
  blood: '#C8301F',
  bloodD: '#9F2316',
  success: '#4A6B3A',
  
  // Legacy aliases mapped to Cream & Blood
  background: '#F0E8D4',
  surface: '#FBF6E8',
  surfaceElevated: '#FBF6E8',
  textPrimary: '#1A1510',
  textSecondary: 'rgba(26,21,16,0.70)',
  textTertiary: 'rgba(26,21,16,0.50)',
  textInverse: '#FBF6E8',
  accent: '#C8301F',
  accentDeep: '#9F2316',
  accentLight: '#E6DCC2',
  accentStripe: '#C8301F',
  navy: '#1A1510',
  navyDeep: '#1A1510',
  navyLight: 'rgba(26,21,16,0.15)',
  ropeTan: '#E6DCC2',
  ropeTanLight: '#F0E8D4',
  slate: 'rgba(26,21,16,0.70)',
  slateLight: 'rgba(26,21,16,0.50)',
  slateLighter: 'rgba(26,21,16,0.30)',
  slateLightest: 'rgba(26,21,16,0.15)',
  statusSigned: '#4A6B3A',
  statusSignedLight: '#E6DCC2',
  statusDraft: 'rgba(26,21,16,0.50)',
  statusDraftLight: '#F0E8D4',
  statusAmended: '#C8301F',
  statusAmendedLight: '#E6DCC2',
  warning: '#C8301F',
  warningLight: '#E6DCC2',
  error: '#C8301F',
  errorLight: '#E6DCC2',
  info: '#1A1510',
  infoLight: 'rgba(26,21,16,0.15)',
  border: '#1A1510',
  borderFocused: '#C8301F',
  hairline: 'rgba(26,21,16,0.15)',
  overlay: 'rgba(26, 21, 16, 0.5)',
} as const;

export const spacing = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 20,
  s6: 24,
  s8: 32,
  s10: 40,
  s12: 48,
  s16: 64,
  // Legacy aliases
  xs: 4, sm: 8, md: 12, base: 16, lg: 24, xl: 32, xxl: 48,
} as const;

export const touchTarget = {
  min: 48,
  preferred: 56,
} as const;

// JetBrains Mono everywhere
const FONT = {
  REGULAR: 'JetBrainsMono_400Regular',
  MEDIUM: 'JetBrainsMono_500Medium',
  BOLD: 'JetBrainsMono_700Bold',
  EXTRABOLD: 'JetBrainsMono_800ExtraBold',
};

export const typography = {
  display: { fontFamily: FONT.EXTRABOLD, fontSize: 58, letterSpacing: -3.48, lineHeight: 50 },
  h1: { fontFamily: FONT.EXTRABOLD, fontSize: 28, letterSpacing: -0.56, lineHeight: 31, textTransform: 'uppercase' as const },
  h2: { fontFamily: FONT.EXTRABOLD, fontSize: 18, letterSpacing: -0.27, lineHeight: 22, textTransform: 'uppercase' as const },
  h3: { fontFamily: FONT.BOLD, fontSize: 14, letterSpacing: 0, lineHeight: 18 },
  body: { fontFamily: FONT.REGULAR, fontSize: 13, letterSpacing: 0, lineHeight: 19 },
  bodyBold: { fontFamily: FONT.BOLD, fontSize: 13, letterSpacing: 0, lineHeight: 19 },
  bodySmall: { fontFamily: FONT.REGULAR, fontSize: 11, letterSpacing: 0, lineHeight: 16 },
  caption: { fontFamily: FONT.BOLD, fontSize: 11, letterSpacing: 0, lineHeight: 16 },
  label: { fontFamily: FONT.BOLD, fontSize: 9, letterSpacing: 2, textTransform: 'uppercase' as const },
  micro: { fontFamily: FONT.MEDIUM, fontSize: 8, letterSpacing: 1.2, textTransform: 'uppercase' as const },
  mono: { fontFamily: FONT.REGULAR, fontSize: 13, letterSpacing: 0, lineHeight: 18 },
  stencil: { fontFamily: FONT.EXTRABOLD, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase' as const },
  stencilLg: { fontFamily: FONT.EXTRABOLD, fontSize: 14, letterSpacing: 1.6, textTransform: 'uppercase' as const },
} as const;

// All borders are 0 radius. Sharp is the aesthetic.
export const radii = { sm: 0, md: 0, lg: 0, full: 0, none: 0 } as const;

export const borders = {
  hair: 1,
  rule: 1.5,
  block: 2,
  heavy: 3,
} as const;

// Elevation comes from borders and inversion, not drop-shadow.
export const shadows = {
  sm: { shadowOpacity: 0, elevation: 0 },
  md: { shadowOpacity: 0, elevation: 0 },
} as const;

export const theme = { colors, spacing, typography, radii, shadows, borders, touchTarget } as const;
export type Theme = typeof theme;
