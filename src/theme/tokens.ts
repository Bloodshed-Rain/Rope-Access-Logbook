// Light theme — cream + deep red + Inter. See docs/superpowers/specs/2026-04-30-light-theme-redesign-design.md §1.

const palette = {
  bgApp:     '#FAF7F2',
  bgSurface: '#FFFFFF',
  bgMuted:   '#F5F2ED',

  border:       '#E5E7EB',
  borderStrong: '#D1D5DB',
  divider:      '#ECEAE5',

  textPrimary:   '#111827',
  textSecondary: '#6B7280',
  textDisabled:  '#9CA3AF',
  textInverse:   '#FFFFFF',

  accentPrimary: '#B71C1C',
  accentPressed: '#8E1212',
  accentTint:    '#FCEAEA',

  statusOk:   '#16A34A',
  statusWarn: '#F59E0B',
  statusErr:  '#DC2626',
  statusInfo: '#2563EB',

  statusOkTint:      '#DCFCE7',
  statusWarnTint:    '#FEF3C7',
  statusErrTint:     '#FEE2E2',
  statusInfoTint:    '#DBEAFE',
  statusNeutralTint: '#F3F4F6',

  certL1: '#2563EB',
  certL2: '#D97706',
  certL3: '#15803D',
} as const;

// Legacy aliases below — every existing screen/primitive reads these. They map
// to the new light-theme palette so dark-industrial code keeps compiling and
// rendering during phases B–E. Aliases removed in Phase F2.
export const colors = {
  ...palette,

  bg:        palette.bgApp,
  bg2:       palette.bgSurface,
  bgBase:    palette.bgApp,
  bgRaised:  palette.bgSurface,
  bgPanel:   palette.bgSurface,
  bgInset:   palette.bgMuted,

  edgeBase:   palette.border,
  edgeHi:     palette.border,
  edgeBright: palette.borderStrong,

  inkPrimary:   palette.textPrimary,
  inkSecondary: palette.textSecondary,
  inkTertiary:  palette.textDisabled,
  inkDisabled:  palette.textDisabled,

  accent:       palette.accentPrimary,
  accentBase:   palette.accentPrimary,
  accentHot:    palette.statusErr,
  accentDeep:   palette.accentPressed,
  accentStripe: palette.accentPrimary,
  accentLight:  palette.accentTint,

  success:      palette.statusOk,
  warning:      palette.statusWarn,
  warningLight: palette.statusWarnTint,
  error:        palette.statusErr,
  errorLight:   palette.statusErrTint,
  info:         palette.statusInfo,
  infoLight:    palette.statusInfoTint,

  surface:         palette.bgSurface,
  surfaceElevated: palette.bgSurface,
  background:      palette.bgApp,
  paper:           palette.bgSurface,

  borderFocused: palette.accentPrimary,
  hairline:      palette.border,

  textTertiary: palette.textDisabled,

  navy:      palette.bgSurface,
  navyDeep:  palette.bgApp,
  navyLight: palette.bgMuted,

  ropeTan:      palette.accentPrimary,
  ropeTanLight: palette.statusErr,

  slate:         palette.textSecondary,
  slateLight:    palette.textDisabled,
  slateLighter:  palette.borderStrong,
  slateLightest: palette.border,

  ink:   palette.textPrimary,
  ink70: palette.textSecondary,
  ink50: palette.textDisabled,
  ink30: palette.borderStrong,
  ink15: palette.border,

  blood:  palette.accentPrimary,
  bloodD: palette.accentPressed,

  statusSigned:       palette.statusOk,
  statusSignedLight:  palette.statusOkTint,
  statusDraft:        palette.statusWarn,
  statusDraftLight:   palette.statusWarnTint,
  statusAmended:      palette.textSecondary,
  statusAmendedLight: palette.statusNeutralTint,

  overlay: 'rgba(0, 0, 0, 0.4)',
} as const;

export const spacing = {
  xs:   4,
  sm:   8,
  md:   12,
  base: 16,
  lg:   24,
  xl:   32,
  xxl:  48,
  s1:  4,
  s2:  8,
  s3:  12,
  s4:  16,
  s5:  20,
  s6:  24,
  s8:  32,
  s10: 40,
  s12: 48,
  s16: 64,
} as const;

export const radii = {
  none: 0,
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  pill: 999,
  full: 999,
} as const;

export const borders = {
  hair:  1,
  rule:  1.5,
  block: 2,
  heavy: 3,
} as const;

export const shadows = {
  sm: {
    shadowColor:   '#000',
    shadowOpacity: 0.04,
    shadowRadius:  4,
    shadowOffset:  { width: 0, height: 1 },
    elevation:     1,
  },
  md: {
    shadowColor:   '#000',
    shadowOpacity: 0.06,
    shadowRadius:  8,
    shadowOffset:  { width: 0, height: 2 },
    elevation:     2,
  },
  accentGlow: {
    shadowColor:   palette.accentPrimary,
    shadowOpacity: 0.18,
    shadowRadius:  8,
    shadowOffset:  { width: 0, height: 0 },
    elevation:     4,
  },
} as const;

export const touchTarget = {
  min:       44,
  preferred: 44,
} as const;

// B2 will register these font names in app.config.ts. Until then they fall
// back to the system font.
const FONT = {
  REGULAR:  'Inter_400Regular',
  MEDIUM:   'Inter_500Medium',
  SEMIBOLD: 'Inter_600SemiBold',
} as const;

export const typography = {
  title1:  { fontFamily: FONT.SEMIBOLD, fontSize: 28, lineHeight: 34, fontWeight: '600' },
  title2:  { fontFamily: FONT.SEMIBOLD, fontSize: 20, lineHeight: 28, fontWeight: '600' },
  body:    { fontFamily: FONT.REGULAR,  fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyMed: { fontFamily: FONT.MEDIUM,   fontSize: 16, lineHeight: 24, fontWeight: '500' },
  label:   { fontFamily: FONT.MEDIUM,   fontSize: 14, lineHeight: 20, fontWeight: '500' },
  caption: { fontFamily: FONT.REGULAR,  fontSize: 12, lineHeight: 16, fontWeight: '400' },

  // Legacy keys — mapped to Inter so industrial screens remain readable until F2.
  display:   { fontFamily: FONT.SEMIBOLD, fontSize: 28, lineHeight: 34, fontWeight: '600' },
  h1:        { fontFamily: FONT.SEMIBOLD, fontSize: 24, lineHeight: 32, fontWeight: '600' },
  h2:        { fontFamily: FONT.SEMIBOLD, fontSize: 20, lineHeight: 28, fontWeight: '600' },
  h3:        { fontFamily: FONT.SEMIBOLD, fontSize: 18, lineHeight: 24, fontWeight: '600' },
  bodyBold:  { fontFamily: FONT.MEDIUM,   fontSize: 16, lineHeight: 24, fontWeight: '500' },
  bodySmall: { fontFamily: FONT.REGULAR,  fontSize: 14, lineHeight: 20, fontWeight: '400' },
  numeric:   { fontFamily: FONT.SEMIBOLD, fontSize: 20, lineHeight: 28, fontWeight: '600' },
  mono:      { fontFamily: FONT.MEDIUM,   fontSize: 14, lineHeight: 20, fontWeight: '500' },
  stencil:   { fontFamily: FONT.SEMIBOLD, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  stencilSm: { fontFamily: FONT.SEMIBOLD, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  stencilLg: { fontFamily: FONT.SEMIBOLD, fontSize: 24, lineHeight: 32, fontWeight: '600' },
  micro:     { fontFamily: FONT.REGULAR,  fontSize: 11, lineHeight: 14, fontWeight: '400' },
} as const;

export const theme = {
  colors,
  spacing,
  typography,
  radii,
  shadows,
  borders,
  touchTarget,
} as const;

export type Theme = typeof theme;
