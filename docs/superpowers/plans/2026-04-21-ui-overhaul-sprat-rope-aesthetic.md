# UI Overhaul — SPRAT / Rope / Industrial Logbook Aesthetic

**Date:** 2026-04-21
**Scope:** Visual-only overhaul of the client app. No services, hooks, DB schema, or Supabase changes.

## Goal

Move the UI away from a generic "social-feed" / Facebook-like aesthetic toward an industrial field-logbook feel that subtly and tastefully references rope access and SPRAT. Use the existing palette — **SPRAT Blue `#003366`**, **Safety Orange `#FF6600`**, **IRATA Red `#C8102E`**, **Rope Tan `#C4A35A`** — with discipline rather than volume.

## Mental model

Climbing hardware + a rigger's bound field notebook + a stenciled inspection stamp. Not a feed. Not a dashboard. A **working document**.

## Diagnosis — what made the current UI feel "Facebook"

1. Flat solid-navy headers with white sans-serif title.
2. Shadow-heavy rounded white cards floating on a neutral gray background.
3. Pill badges + full-radius chips everywhere (generic social rhythm).
4. Opacity-based press states (no physicality).
5. `FlatList` feed with no grouping, every row visually equivalent.
6. Background `#F2F2F2` concrete — cold, generic.

## Color discipline (the "tasteful" rule)

- **SPRAT Blue** — structural chrome only. Headers, tab bar, ID-card surfaces, secondary outlined buttons. **Never** a flat CTA background.
- **Safety Orange** — primary CTAs, focus ring, tab-bar hairline, active list-row accent stripe. **Rule of thumb: one primary orange element visible per screen.**
- **IRATA Red** — destructive actions only (delete account, revoke supervisor) and the `amended` status stamp. Nowhere else.
- **Rope Tan** — faint hairlines, rope-divider SVG fills, stencil text on navy panels. Warmth, not volume.
- **Paper off-white `#F5F2EC`** — new background color replacing `#F2F2F2`. Reads as logbook paper rather than app chrome.

## New token additions (`src/theme/tokens.ts`)

```ts
colors: {
  // ...existing
  paper: '#F5F2EC',            // warm logbook off-white (replaces use of `background` where appropriate)
  navyDeep: '#00264D',         // darker navy for header gradients / pressed nav
  accentStripe: '#FF6600',     // semantic alias for the 3px accent rule
  hairline: 'rgba(0,51,102,0.12)', // navy-tinted 12% hairlines
  ropeTanLight: '#EDE3CD',     // soft rope-tan tint for subtle fills
}

radii: { sm: 4, md: 8, lg: 12, full: 9999 } // tightened from 6/10/14

typography: {
  // ...existing
  stencil: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
}
```

> Keep the existing `background` token for backwards compat, but switch `Screen` to `paper`.

## New primitives

### `RopeDivider.tsx`

Pure SVG (`react-native-svg` already installed). Renders a thin horizontal twisted-rope pattern.

```ts
interface RopeDividerProps {
  color?: string; // defaults to ropeTan
  height?: number; // default 6
  opacity?: number; // default 0.35
  style?: ViewStyle;
}
```

Implementation: a repeating `<Path>` of two offset sine curves suggesting rope strands. Not a photographic texture — geometric, minimal. Used **only** in three places: under screen/stack headers, at section breaks on Profile/Paywall, and the Onboarding hero.

### `StampBadge.tsx`

Rotated stencil text with a double-stroke outline. For detail screens only.

```ts
interface StampBadgeProps {
  label: string; // "SIGNED" | "DRAFT" | "AMENDED"
  variant: "signed" | "draft" | "amended";
  rotation?: number; // default -8deg
}
```

Color mapping: signed → `statusSigned`, draft → `slate`, amended → `error` (IRATA Red). Font uses `typography.stencil` scaled up.

### `SectionHeader.tsx`

Small-caps label with a 1 px orange hairline underline.

```ts
interface SectionHeaderProps {
  label: string;
  accent?: "orange" | "navy" | "tan"; // default orange
  right?: React.ReactNode; // optional action (e.g., "Edit")
}
```

## Primitive re-skins

### `Button.tsx`

- Primary: Safety Orange bg, `typography.stencil`-style label (uppercase, letter-spaced), deep press inset (translateY 1 + darker bg) instead of opacity.
- Secondary: transparent bg, 2 px navy border, navy label (sentence-case OK here — uppercase only on primary/danger).
- Ghost: text-only in navy.
- Danger: IRATA Red bg, stencil label.
- Optional `haptic` prop (defaults `true` for primary/danger) calling `Haptics.impactAsync(ImpactFeedbackStyle.Light)` from `expo-haptics` on press.

### `Card.tsx`

- 1 px `hairline` border, `radii.md`, shadow downgraded to near-none (`shadowOpacity: 0.04`).
- New optional prop: `accent?: 'orange' | 'navy' | 'red' | 'tan'` — renders a 3 px left stripe of that color (inspection-form tab feel).
- Background: `surface` by default; `paper` on paper-on-paper contexts.

### `Banner.tsx`

- White/paper bg (no more tinted fills).
- 4 px left colored bar in variant color.
- Variant icon on the left (lucide: `AlertTriangle`, `Info`, `CheckCircle2`, `XCircle`).
- `X` lucide icon for dismiss instead of the literal `x` text.

### `Chip.tsx`

- Unselected: transparent bg, 1.5 px navy border, navy label.
- Selected: navy fill, white label.
- Radius `md` (not `full`).
- Pressed state: 1 px translateY inset.

### `ListRow.tsx`

- Hairline bottom border in `hairline` token.
- On press: 3 px Safety Orange left accent stripe animates in (or just appears — no animation required); faint `ropeTanLight` background tint instead of gray.
- Preserve touch-target size and API.

### `Screen.tsx`

- Background switches to `colors.paper`.
- New optional prop `topDivider?: boolean` — renders `RopeDivider` immediately below the safe area top, useful for screens without a stack/tab header.

### `EmptyState.tsx`

- Center `RopeDivider` (width ~120px) above the title.
- Title uses `h1`; optional small stencil caption under the button.

## Navigation chrome (`RootNavigator.tsx`)

### Tab bar

- Keep navy background.
- Add a 2 px Safety Orange top hairline (`borderTopWidth: 2, borderTopColor: colors.accent`).
- Active tab: keep orange icon/label tint, and render a tiny 4 px orange dot centered under the label (via a custom `tabBarLabel` renderer).

### Stack headers

- Keep navy background.
- Add a `RopeDivider` with `color={colors.ropeTan}`, `opacity={0.45}` along the bottom edge via `headerBackground` rendering a navy view + absolutely positioned divider at the bottom.
- Header title uses `typography.h2` weight 700 (unchanged) but with `letterSpacing: 0.5` — subtle stencil influence without shouting.

## Screen-level updates

### `LogbookScreen.tsx`

- **Header panel:** replace plain "Logbook" + hours count with:
  - Small stencil wordmark "RALB · ROPE ACCESS LOGBOOK" in `ropeTan` on navy.
  - Larger display: `{totalHours}h` big numeric, "this year" stencil caption.
  - `RopeDivider` across the bottom of the navy panel.
  - Action row: `Download` icon button (ghost-on-navy), `Plus` button in Safety Orange.
- **List:** group entries by `YYYY-MM`. Each group starts with a `SectionHeader` (`APR · 2026` style, via `date-fns`-free manual formatting using the existing date string). `ListRow` unchanged structurally.
- Remove the fade-in `Animated.View` per row (feels feed-like); keep a subtle fade only on initial mount of the whole list.

### `EntryDetailScreen.tsx`

- Top of screen: entry title + `StampBadge` (absolute-positioned, -8deg rotation, opacity 0.85) in the top-right corner of the summary card.
- Section blocks use `SectionHeader`:
  - `DATES & HOURS`
  - `LOCATION & EMPLOYER`
  - `WORK PERFORMED`
  - `SUPERVISOR`
  - `SIGNATURE`
- `Card` instances use `accent="navy"` left stripe, except the signature card which uses `accent="orange"` when unsigned and `accent="tan"` when signed.
- Amend CTA uses `variant="danger"` only (IRATA Red) — reinforces that amendment is a formal, non-casual action.

### `OnboardingScreen.tsx`

- Hero: centered rope figure-8 knot as an inline SVG (no external asset needed; geometric 2-strand curves, ~160×160, stroke in `navy` with a `ropeTan` inner strand).
- Tagline uses `typography.h1`, subhead uses `typography.body`.
- Primary CTA: stencil "START LOGGING".
- Ghost "SIGN IN" below.

### `ProfileScreen.tsx`

- Top: "ID card" panel — navy background, ropeTan stencil label "TECHNICIAN", white display name, stencil subline with level/number.
- `RopeDivider` at the bottom of the panel.
- Subsequent sections use `SectionHeader`: `ACCOUNT`, `CLOUD BACKUP`, `SUPERVISORS`, `EXPORTS`, `SUBSCRIPTION`.
- Swap profile/user glyph to `HardHat` from lucide where it reads naturally.

### `PaywallScreen.tsx`

- Stencil "PRO" wordmark large, Safety Orange, with a `ropeTan` hairline underline.
- Feature list uses `SectionHeader` ("WHAT YOU GET") and bulleted rows with small `Anchor`/`Link`/`CheckCircle2` icons.
- CTA is a full-width primary button "UNLOCK PRO" with haptic.

### `AuthScreen.tsx` / `MagicLinkWaitScreen.tsx`

- Centered paper card with `accent="orange"` stripe.
- `SectionHeader` "SIGN IN" at top.
- Rope divider beneath the form.

### Remaining screens

`AnalyticsScreen`, `InboxScreen`, `SupervisorSearchScreen`, `SignRequestDetailScreen`, `EntryFormScreen`, `SignatureScreen`, `CloudConflictScreen` — **no layout rewrites**. They already consume primitives and `useTheme()`; they pick up the new look automatically. Apply surgical consistency tweaks:

- Replace any ad-hoc "section title" `<Text>` with `SectionHeader`.
- Replace tinted-background `Banner` usages — already handled by primitive update.
- Ensure any inline button styling uses the new `Button` variants.

## Implementation order (do not reorder)

1. Tokens (step 1) — additive, no visual impact yet.
2. New primitives (2–5) — still no visual impact.
3. Primitive re-skins (6–12) — **this is where the app visually transforms**, since every screen consumes these.
4. Navigation chrome (13).
5. Screen-specific polish (14–19).
6. Verification (20–21).

After step 3, the entire app should already look industrial. Steps 4–5 add the memorable details.

## Verification

- `npx tsc --noEmit` — must pass.
- `.\node_modules\.bin\jest.cmd --runInBand` — must pass. No service/hook logic changed, so only failures should come from primitive snapshot/DOM-based tests if any exist (there are none in `__tests__/` currently).
- Manual pass on: Logbook, Entry Detail (signed + draft + amended), Profile, Paywall, Onboarding, Auth, Sign Request Detail, Supervisor Search.
- **One-orange-per-screen rule** — scan each screen, confirm only one primary orange element is dominant (CTAs, focus, or active accent — not multiple simultaneously).
- **IRATA Red rule** — grep for `error` / `statusAmended` usages and confirm they only appear on destructive actions or amended state.

## Non-goals

- No new runtime dependencies. `react-native-svg` and `expo-haptics` are already installed.
- No icon/splash regeneration pass (`assets/*.png` stay as-is for this overhaul).
- No dark mode (current theme has no dark tokens; adding it is a separate project).
- No animation framework (Reanimated) introduction. Existing `Animated` API only.
- No changes to PDF export templates — those are separate styling concerns in `src/templates/`.

## Rollback plan

Because changes are token + primitive driven, reverting is either:

1. `git revert` the tokens + primitives commits — screen code doesn't need to change.
2. Or ship a feature flag on `Screen` that swaps between `paper` and legacy `background`; not recommended — clean revert is simpler.
