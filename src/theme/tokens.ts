// Light theme — cream + deep red + Inter. See docs/superpowers/specs/2026-04-30-light-theme-redesign-design.md §1

// ─── Canonical color palette ──────────────────────────────────────────────────
const palette = {
  // Backgrounds
  bgApp:     '#FAF7F2', // warm off-white, primary background
  bgSurface: '#FFFFFF', // cards, sheets
  bgMuted:   '#F5F2ED', // inputs, inset blocks

  // Borders / dividers
  border:  '#E5E7EB',
  divider: '#ECEAE5',

  // Text
  textPrimary:   '#111827',
  textSecondary: '#6B7280',
  textDisabled:  '#9CA3AF',

  // Accent — deep red
  accentPrimary: '#B71C1C', // CTAs, hero progress, focus rings
  accentPressed: '#8E1212',
  accentTint:    '#FCEAEA', // pressed surfaces, highlights

  // Status
  statusOk:   '#16A34A', // signed
  statusWarn: '#F59E0B', // draft / awaiting / needs signature / lapse-soon
  statusErr:  '#DC2626', // expired, lapsed
  statusInfo: '#2563EB', // informational

  // Cert level chips
  certL1: '#2563EB', // blue
  certL2: '#D97706', // deep amber
  certL3: '#15803D', // deep green
} as const;

export const colors = {
  // ── New canonical keys ────────────────────────────────────────────────────
  ...palette,

  // ── Legacy aliases — every existing screen/primitive reads these. Mapped to
  //    the new light-theme palette so old code keeps compiling and rendering
  //    until Phase F removes the aliases. ────────────────────────────────────

  // Background aliases
  bg:        palette.bgApp,
  bg2:       palette.bgSurface,
  bgBase:    palette.bgApp,
  bgRaised:  palette.bgSurface,
  bgPanel:   palette.bgSurface,
  bgInset:   palette.bgMuted,

  // Edge / border aliases
  edgeBase:   palette.border,
  edgeHi:     palette.border,
  edgeBright: '#D1D5DB',

  // Ink aliases
  inkPrimary:  palette.textPrimary,
  inkSecondary: palette.textSecondary,
  inkTertiary: palette.textDisabled,
  inkDisabled: palette.textDisabled,

  // Accent aliases
  accent:       palette.accentPrimary,
  accentBase:   palette.accentPrimary,
  accentHot:    palette.statusErr,  // was orange-hot; now maps to red
  accentDeep:   palette.accentPressed,
  accentStripe: palette.accentPrimary,
  accentLight:  palette.accentTint,

  // Status / semantic aliases
  success:      palette.statusOk,
  warning:      palette.statusWarn,
  warningLight: '#FEF3C7',
  error:        palette.statusErr,
  errorLight:   '#FEE2E2',
  info:         palette.statusInfo,
  infoLight:    '#DBEAFE',

  // Surface aliases
  surface:         palette.bgSurface,
  surfaceElevated: palette.bgSurface,
  background:      palette.bgApp,
  paper:           palette.bgSurface,

  // Border aliases
  // `border` is already the canonical key above via ...palette
  borderFocused: palette.accentPrimary,
  hairline:      palette.border,
  // `divider` is already the canonical key above via ...palette

  // Text aliases
  // `textPrimary` / `textSecondary` / `textDisabled` are canonical above
  textTertiary: palette.textDisabled,
  textInverse:  '#FFFFFF',

  // Chrome aliases (was dark navy header bars — now light surfaces)
  navy:      palette.bgSurface,
  navyDeep:  palette.bgApp,
  navyLight: palette.bgMuted,

  // Rope-tan aliases (accent text on chrome)
  ropeTan:      palette.accentPrimary,
  ropeTanLight: palette.statusErr,

  // Slate aliases
  slate:        palette.textSecondary,
  slateLight:   palette.textDisabled,
  slateLighter: '#D1D5DB',
  slateLightest: palette.border,

  // Ink opacity aliases
  ink:   palette.textPrimary,
  ink70: palette.textSecondary,
  ink50: palette.textDisabled,
  ink30: '#D1D5DB',
  ink15: palette.border,

  // Blood aliases (was safety-orange danger; now deep red)
  blood:  palette.accentPrimary,
  bloodD: palette.accentPressed,

  // Status badge aliases
  statusSigned:       palette.statusOk,
  statusSignedLight:  '#DCFCE7',
  statusDraft:        palette.statusWarn,
  statusDraftLight:   '#FEF3C7',
  statusAmended:      palette.textSecondary,
  statusAmendedLight: '#F3F4F6',

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.4)', // lighter than industrial since bg is now light
} as const;

// ─── Spacing — base 4px ───────────────────────────────────────────────────────
export const spacing = {
  // Canonical keys
  xs:   4,
  sm:   8,
  md:   12,
  base: 16,
  lg:   24,
  xl:   32,
  xxl:  48,
  // Legacy numeric keys (sN = N × 4)
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

// ─── Radii ────────────────────────────────────────────────────────────────────
export const radii = {
  none: 0,
  xs:   4,   // small chip rounding (legacy)
  sm:   8,
  md:   12,
  lg:   16,
  pill: 999,
  full: 999,
} as const;

// ─── Borders ─────────────────────────────────────────────────────────────────
export const borders = {
  hair:  1,
  rule:  1.5,
  block: 2,
  heavy: 3,
} as const;

// ─── Shadows — real depth now that bg is light ────────────────────────────────
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
    shadowColor:   '#B71C1C',
    shadowOpacity: 0.18,
    shadowRadius:  8,
    shadowOffset:  { width: 0, height: 0 },
    elevation:     4,
  },
} as const;

// ─── Touch targets — 44pt minimum (glove use assumed) ────────────────────────
export const touchTarget = {
  min:       44,
  preferred: 44,
} as const;

// ─── Typography — Inter family ────────────────────────────────────────────────
// B2 will register these font names in app.config.ts.
// Until then they fall back to the system font — expected and tolerated.
const FONT = {
  REGULAR:  'Inter_400Regular',
  MEDIUM:   'Inter_500Medium',
  SEMIBOLD: 'Inter_600SemiBold',
} as const;

export const typography = {
  // ── Canonical new keys ────────────────────────────────────────────────────
  title1:  { fontFamily: FONT.SEMIBOLD, fontSize: 28, lineHeight: 34, fontWeight: '600' as const },
  title2:  { fontFamily: FONT.SEMIBOLD, fontSize: 20, lineHeight: 28, fontWeight: '600' as const },
  body:    { fontFamily: FONT.REGULAR,  fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  bodyMed: { fontFamily: FONT.MEDIUM,   fontSize: 16, lineHeight: 24, fontWeight: '500' as const },
  label:   { fontFamily: FONT.MEDIUM,   fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  caption: { fontFamily: FONT.REGULAR,  fontSize: 12, lineHeight: 16, fontWeight: '400' as const },

  // ── Legacy keys — mapped to Inter so industrial screens remain readable ───
  // (visual oddities tolerated; aliases removed in Phase F)
  display:   { fontFamily: FONT.SEMIBOLD, fontSize: 28, lineHeight: 34, fontWeight: '600' as const },
  h1:        { fontFamily: FONT.SEMIBOLD, fontSize: 24, lineHeight: 32, fontWeight: '600' as const },
  h2:        { fontFamily: FONT.SEMIBOLD, fontSize: 20, lineHeight: 28, fontWeight: '600' as const },
  h3:        { fontFamily: FONT.SEMIBOLD, fontSize: 18, lineHeight: 24, fontWeight: '600' as const },
  bodyBold:  { fontFamily: FONT.MEDIUM,   fontSize: 16, lineHeight: 24, fontWeight: '500' as const },
  bodySmall: { fontFamily: FONT.REGULAR,  fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  numeric:   { fontFamily: FONT.SEMIBOLD, fontSize: 20, lineHeight: 28, fontWeight: '600' as const },
  mono:      { fontFamily: FONT.MEDIUM,   fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  // Stencil: Michroma is gone; render as Inter semibold — still readable
  stencil:   { fontFamily: FONT.SEMIBOLD, fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  stencilSm: { fontFamily: FONT.SEMIBOLD, fontSize: 12, lineHeight: 16, fontWeight: '600' as const },
  stencilLg: { fontFamily: FONT.SEMIBOLD, fontSize: 24, lineHeight: 32, fontWeight: '600' as const },
  micro:     { fontFamily: FONT.REGULAR,  fontSize: 11, lineHeight: 14, fontWeight: '400' as const },
} as const;

// ─── Theme composite + type ───────────────────────────────────────────────────
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
