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

export const colors = {
  ...palette,

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
