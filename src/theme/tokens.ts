// src/theme/tokens.ts
// Industrial Gauge-Panel Design System
// Dark-only. Aesthetic is machined metal: sharp edges, stencil typography,
// safety-orange CTAs, status LEDs. See docs/superpowers/specs/2026-04-25-ui-overhaul-industrial-design.md.

// --- Canonical color tokens (new) ---
const palette = {
  bgBase:        '#0a0b0d',
  bgRaised:      '#111418',
  bgPanel:       '#181c22',
  bgInset:       '#1f242b',
  edgeBase:      '#262c34',
  edgeHi:        '#3a4048',
  edgeBright:    '#515864',
  inkPrimary:    '#dde3eb',
  inkSecondary:  '#a3abb6',
  inkTertiary:   '#616977',
  inkDisabled:   '#3f4650',
  accentBase:    '#ff5a1f',
  accentHot:     '#ff7a3d',
  accentDeep:    '#c63f10',
  statusWarn:    '#f5a524',
  statusOk:      '#3fb950',
  statusErr:     '#e5484d',
  certL1:        '#6fb7ff',
  certL2:        '#ffb857',
  certL3:        '#ff7a3d',
} as const;

export const colors = {
  // New canonical keys — preferred for new code.
  ...palette,

  // Legacy aliases — every existing screen / primitive reads these. Mapped to
  // new values so the dark theme applies without touching call sites.
  bg:             palette.bgBase,
  bg2:            palette.bgRaised,
  paper:          palette.bgPanel,
  ink:            palette.inkPrimary,
  ink70:          palette.inkSecondary,
  ink50:          palette.inkTertiary,
  ink30:          palette.inkDisabled,
  ink15:          palette.edgeBase,
  blood:          palette.statusErr,
  bloodD:         palette.statusErr,
  success:        palette.statusOk,
  background:     palette.bgBase,
  surface:        palette.bgPanel,
  surfaceElevated: palette.bgRaised,
  textPrimary:    palette.inkPrimary,
  textSecondary:  palette.inkSecondary,
  textTertiary:   palette.inkTertiary,
  textInverse:    palette.bgBase, // text "on accent" — dark on orange button
  accent:         palette.accentBase,
  accentDeep:     palette.accentDeep,
  accentLight:    palette.bgRaised,
  accentStripe:   palette.accentBase,
  navy:           palette.bgRaised,    // chrome (was navy header bar)
  navyDeep:       palette.bgBase,
  navyLight:      palette.bgPanel,
  ropeTan:        palette.accentBase,  // accent text on chrome
  ropeTanLight:   palette.accentHot,
  slate:          palette.inkSecondary,
  slateLight:     palette.inkTertiary,
  slateLighter:   palette.inkDisabled,
  slateLightest:  palette.edgeBase,
  statusSigned:       palette.statusOk,
  statusSignedLight:  palette.bgPanel,
  statusDraft:        palette.inkTertiary,
  statusDraftLight:   palette.bgPanel,
  statusAmended:      palette.statusErr,
  statusAmendedLight: palette.bgPanel,
  warning:        palette.statusWarn,
  warningLight:   palette.bgPanel,
  error:          palette.statusErr,
  errorLight:     palette.bgPanel,
  info:           palette.inkSecondary,
  infoLight:      palette.bgPanel,
  border:         palette.edgeBase,
  borderFocused:  palette.accentBase,
  hairline:       palette.edgeBase,
  overlay:        'rgba(0, 0, 0, 0.7)',
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

const FONT = {
  REGULAR: 'JetBrainsMono_400Regular',
  MEDIUM: 'JetBrainsMono_500Medium',
  BOLD: 'JetBrainsMono_700Bold',
  EXTRABOLD: 'JetBrainsMono_800ExtraBold',
  STENCIL: 'Michroma_400Regular',
} as const;

export const typography = {
  display:    { fontFamily: FONT.EXTRABOLD, fontSize: 46, letterSpacing: -0.92, lineHeight: 46 },
  h1:         { fontFamily: FONT.EXTRABOLD, fontSize: 24, letterSpacing: -0.48, lineHeight: 28 },
  h2:         { fontFamily: FONT.BOLD,      fontSize: 18, letterSpacing: -0.18, lineHeight: 22 },
  h3:         { fontFamily: FONT.BOLD,      fontSize: 14, letterSpacing: 0,     lineHeight: 18 },
  body:       { fontFamily: FONT.REGULAR,   fontSize: 14, letterSpacing: 0,     lineHeight: 20 },
  bodyBold:   { fontFamily: FONT.BOLD,      fontSize: 14, letterSpacing: 0,     lineHeight: 20 },
  bodySmall:  { fontFamily: FONT.REGULAR,   fontSize: 12, letterSpacing: 0.24,  lineHeight: 17 },
  numeric:    { fontFamily: FONT.BOLD,      fontSize: 22, letterSpacing: -0.44, lineHeight: 22 },
  caption:    { fontFamily: FONT.MEDIUM,    fontSize: 10, letterSpacing: 0.4,   lineHeight: 14 },
  label:      { fontFamily: FONT.STENCIL,   fontSize: 9.5, letterSpacing: 2.1,  textTransform: 'uppercase' as const },
  micro:      { fontFamily: FONT.STENCIL,   fontSize: 8.5, letterSpacing: 1.7,  textTransform: 'uppercase' as const },
  mono:       { fontFamily: FONT.MEDIUM,    fontSize: 13, letterSpacing: 0,     lineHeight: 18 },
  stencil:    { fontFamily: FONT.STENCIL,   fontSize: 9.5, letterSpacing: 2.1,  textTransform: 'uppercase' as const },
  stencilSm:  { fontFamily: FONT.STENCIL,   fontSize: 8.5, letterSpacing: 1.7,  textTransform: 'uppercase' as const },
  stencilLg:  { fontFamily: FONT.STENCIL,   fontSize: 11,  letterSpacing: 2.0,  textTransform: 'uppercase' as const },
} as const;

// Industrial = sharp. Most surfaces are squared.
export const radii = {
  none: 0,
  xs: 2,
  sm: 4,
  md: 0,    // legacy alias — sharp
  lg: 0,    // legacy alias — sharp
  full: 999,
  pill: 999,
} as const;

export const borders = {
  hair: 1,
  rule: 1.5,
  block: 2,
  heavy: 3,
} as const;

// Glow on accent surfaces lives via shadowColor + accent base; layered strokes
// elsewhere. Keep stub for legacy callers.
export const shadows = {
  sm: { shadowOpacity: 0, elevation: 0 },
  md: { shadowOpacity: 0, elevation: 0 },
  accentGlow: {
    shadowColor: palette.accentBase,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
} as const;

export const theme = { colors, spacing, typography, radii, shadows, borders, touchTarget } as const;
export type Theme = typeof theme;
