// src/screens/EntryFormScreen.tsx
// Add Work — 2-step wizard. Spec §7 lines 319-336.
//
//   Step 1 — "Where & when":  site, employer, when (Today/Yesterday/Custom),
//             hours.  See entryForm/Step1.tsx.
//   Step 2 — "What did you do": work types (multi-select), Other description,
//             notes.  See entryForm/Step2.tsx.
//
// Edit (route.params.entryId) and amend (route.params.amendEntryId) modes are
// preserved. Photo attachment UI is dropped from the wizard per spec; existing
// entries with photo_paths pass through edit untouched so EntryDetail keeps
// rendering them. Equipment notes / weather / client likewise survive but no
// longer have a wizard surface.
//
// After save, the wizard navigates to EntryDetail as a temporary landing
// target. D2 will redirect into the PostSaveSheet.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { X } from 'lucide-react-native';
import { Screen, LoadingSpinner, Button, Textarea, useToast } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile } from '../hooks/useProfile';
import {
  useEntries,
  useEntry,
  useCreateEntry,
  useUpdateEntry,
  useCreateAmendment,
} from '../hooks/useEntries';
import { toISODate } from '../utils/dateRange';
import { RootStackParamList } from '../navigation/RootNavigator';
import { Entry } from '../types';
import { Step1 } from './entryForm/Step1';
import { Step2 } from './entryForm/Step2';
import { WhenChoice, WizardState, WizardStep } from './entryForm/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type FormRoute = RouteProp<RootStackParamList, 'EntryForm'>;

function todayISO(): string {
  return toISODate(new Date());
}

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toISODate(d);
}

function inferWhenChoice(from: string, to: string): WhenChoice {
  if (from !== to) return 'custom';
  if (from === todayISO()) return 'today';
  if (from === yesterdayISO()) return 'yesterday';
  return 'custom';
}

function buildInitialState(defaultEmployer: string, existing: Entry | undefined): WizardState {
  if (existing) {
    return {
      site: existing.site,
      employer: existing.employer,
      dateFrom: existing.date_from,
      dateTo: existing.date_to,
      when: inferWhenChoice(existing.date_from, existing.date_to),
      workHours: existing.work_hours > 0 ? String(existing.work_hours) : '',
      workTypes: existing.work_types,
      otherWorkDescription: existing.other_work_description ?? '',
      notes: existing.description,
      amendmentReason: '',
      client: existing.client,
      equipmentNotes: existing.equipment_notes ?? '',
      weather: existing.weather ?? '',
      photoPaths: existing.photo_paths ?? [],
    };
  }
  const today = todayISO();
  return {
    site: '',
    employer: defaultEmployer,
    dateFrom: today,
    dateTo: today,
    when: 'today',
    workHours: '',
    workTypes: [],
    otherWorkDescription: '',
    notes: '',
    amendmentReason: '',
    client: '',
    equipmentNotes: '',
    weather: '',
    photoPaths: [],
  };
}

function statesEqual(a: WizardState, b: WizardState): boolean {
  if (a.site !== b.site) return false;
  if (a.employer !== b.employer) return false;
  if (a.dateFrom !== b.dateFrom) return false;
  if (a.dateTo !== b.dateTo) return false;
  if (a.when !== b.when) return false;
  if (a.workHours !== b.workHours) return false;
  if (a.notes !== b.notes) return false;
  if (a.otherWorkDescription !== b.otherWorkDescription) return false;
  if (a.amendmentReason !== b.amendmentReason) return false;
  if (a.workTypes.length !== b.workTypes.length) return false;
  for (const t of a.workTypes) if (!b.workTypes.includes(t)) return false;
  return true;
}

export function EntryFormScreen() {
  const { colors, spacing, typography, radii, borders } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<FormRoute>();
  const toast = useToast();

  const editId = route.params?.entryId;
  const amendId = route.params?.amendEntryId;
  const isEdit = !!editId;
  const isAmend = !!amendId;
  const needsExistingEntry = isEdit || isAmend;

  const { data: profile } = useProfile();
  const { data: existingEntry, isLoading: existingLoading } = useEntry(
    editId ?? amendId ?? '',
  );
  const { data: allEntries = [] } = useEntries();

  const createEntry = useCreateEntry();
  const updateEntry = useUpdateEntry();
  const createAmendment = useCreateAmendment();

  const [initial, setInitial] = useState<WizardState>(() =>
    buildInitialState(profile?.default_employer ?? '', undefined),
  );
  const [state, setState] = useState<WizardState>(initial);
  const [step, setStep] = useState<WizardStep>(1);
  const [hydrated, setHydrated] = useState<boolean>(!needsExistingEntry);
  const isLeavingIntentionally = useRef(false);

  // In amend mode the body is read-only; only the amendment reason can be
  // dirty, and `statesEqual` doesn't see it because amend uses its own form.
  const isDirty = useMemo(() => {
    if (isAmend) return state.amendmentReason.trim().length > 0;
    return !statesEqual(state, initial);
  }, [isAmend, state, initial]);

  // Hydrate from the loaded existing entry once for edit/amend. The default
  // covers the new-entry path; this effect re-seeds both `initial` and `state`
  // so the dirty check stays anchored to the loaded values. We only hydrate
  // once: if the user has begun editing, a late-arriving query result must not
  // clobber their input.
  useEffect(() => {
    if (!needsExistingEntry || hydrated || !existingEntry) return;
    const seed = buildInitialState(profile?.default_employer ?? '', existingEntry);
    setInitial(seed);
    setState(seed);
    setHydrated(true);
  }, [needsExistingEntry, hydrated, existingEntry, profile?.default_employer]);

  // Cancel guard.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (isLeavingIntentionally.current || !isDirty) return;
      e.preventDefault();
      Alert.alert(
        'Discard this entry?',
        'You have unsaved changes. Discard them?',
        [
          { text: 'Keep editing', style: 'cancel', onPress: () => {} },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              isLeavingIntentionally.current = true;
              navigation.dispatch(e.data.action);
            },
          },
        ],
      );
    });
    return sub;
  }, [navigation, isDirty]);

  // Distinct prior employers, sorted, for the Step1 picker.
  const distinctEmployers = useMemo(() => {
    const set = new Set<string>();
    for (const e of allEntries) {
      const v = e.employer.trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort();
  }, [allEntries]);

  const update = <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  const hoursNum = parseFloat(state.workHours);
  const step1Valid =
    state.site.trim().length > 0 &&
    state.employer.trim().length > 0 &&
    !Number.isNaN(hoursNum) &&
    hoursNum > 0 &&
    !!state.dateFrom &&
    !!state.dateTo &&
    state.dateFrom <= state.dateTo;

  const step2Valid =
    state.workTypes.length >= 1 &&
    (!state.workTypes.includes('other') || state.otherWorkDescription.trim().length > 0);

  const amendValid = state.amendmentReason.trim().length > 0;

  const isSaving =
    createEntry.isPending || updateEntry.isPending || createAmendment.isPending;

  // Surfaces save failures to the user. Mirrors MeScreen's export-error pattern.
  const handleSaveError = (err: unknown) => {
    const message = (err as Error)?.message ?? String(err);
    toast.show({ message: `Couldn't save: ${message}`, variant: 'err' });
  };

  const handleSave = async () => {
    if (!profile) return;

    const techLevel = profile.level ?? 'I';

    try {
      let savedId: string;
      if (isAmend && amendId) {
        if (!amendValid) return;
        // createAmendment clones the original entry verbatim — the amend form
        // captures only the reason. The user lands on the new draft and can
        // edit body fields via EntryDetail → Edit Entry, which routes through
        // edit-mode (which DOES pass body edits through useUpdateEntry).
        const amendment = await createAmendment.mutateAsync({
          entryId: amendId,
          reason: state.amendmentReason.trim(),
          techLevel,
        });
        savedId = amendment.id;
      } else if (isEdit && editId) {
        if (!step1Valid || !step2Valid) return;
        const otherText =
          state.workTypes.includes('other') && state.otherWorkDescription.trim()
            ? state.otherWorkDescription.trim()
            : null;
        await updateEntry.mutateAsync({
          id: editId,
          input: {
            date_from: state.dateFrom,
            date_to: state.dateTo,
            employer: state.employer.trim(),
            site: state.site.trim(),
            // client is NOT NULL in the schema; trim only.
            client: state.client.trim(),
            description: state.notes,
            work_hours: hoursNum,
            work_types: state.workTypes,
            // Coerce empty strings to null for nullable string columns so we
            // don't spuriously overwrite null with "" and bump updated_at.
            other_work_description: otherText,
            equipment_notes: state.equipmentNotes.trim() || null,
            weather: state.weather.trim() || null,
            photo_paths: state.photoPaths,
          },
        });
        savedId = editId;
      } else {
        if (!step1Valid || !step2Valid) return;
        const otherText =
          state.workTypes.includes('other') && state.otherWorkDescription.trim()
            ? state.otherWorkDescription.trim()
            : null;
        const created = await createEntry.mutateAsync({
          input: {
            date_from: state.dateFrom,
            date_to: state.dateTo,
            employer: state.employer.trim(),
            site: state.site.trim(),
            description: state.notes,
            work_hours: hoursNum,
            work_types: state.workTypes,
            other_work_description: otherText,
          },
          techLevel,
        });
        savedId = created.id;
      }

      // Side-effects fire only after the mutation resolves successfully.
      isLeavingIntentionally.current = true;
      // TODO(D2): swap this for the PostSaveSheet handoff.
      navigation.replace('EntryDetail', { entryId: savedId });
    } catch (err) {
      handleSaveError(err);
    }
  };

  const headerTitle = isAmend ? 'Amend entry' : isEdit ? 'Edit entry' : 'New entry';

  // Block the wizard render until existing-entry data is hydrated so the user
  // can never type into a stale form that's about to be overwritten. The
  // header's close button stays available the whole time.
  const showLoading = needsExistingEntry && !hydrated && existingLoading;

  return (
    <Screen padded={false}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.base,
          paddingTop: spacing.md,
          paddingBottom: spacing.sm,
        }}
      >
        <Text style={[typography.title1, { color: colors.textPrimary }]}>
          {headerTitle}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <X size={22} color={colors.textPrimary} />
        </Pressable>
      </View>

      {/* Progress strip — wizard only. Amend mode is one screen. */}
      {!isAmend && (
        <View
          style={{
            paddingHorizontal: spacing.base,
            paddingBottom: spacing.md,
            gap: spacing.xs,
          }}
        >
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {`Step ${step} of 2`}
          </Text>
          <View
            style={{
              height: 4,
              backgroundColor: colors.bgMuted,
              borderRadius: radii.pill,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: step === 1 ? '50%' : '100%',
                height: '100%',
                backgroundColor: colors.accentPrimary,
                borderRadius: radii.pill,
              }}
            />
          </View>
        </View>
      )}

      {showLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <LoadingSpinner />
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: spacing.base,
              paddingBottom: spacing.xxl,
              gap: spacing.base,
            }}
            keyboardShouldPersistTaps="handled"
          >
            {isAmend ? (
              <AmendForm
                original={existingEntry ?? null}
                reason={state.amendmentReason}
                onChangeReason={(t) => update('amendmentReason', t)}
                isSaving={isSaving}
                canSave={amendValid}
                onSave={handleSave}
                colors={colors}
                spacing={spacing}
                typography={typography}
                radii={radii}
                borders={borders}
              />
            ) : step === 1 ? (
              <Step1
                state={state}
                update={update}
                setState={setState}
                distinctEmployers={distinctEmployers}
                step1Valid={step1Valid}
                onNext={() => setStep(2)}
              />
            ) : (
              <Step2
                state={state}
                update={update}
                setState={setState}
                step1Valid={step1Valid}
                step2Valid={step2Valid}
                isSaving={isSaving}
                onBack={() => setStep(1)}
                onSave={handleSave}
              />
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AmendForm — reason-only form for amending a signed entry.
//
// `entriesService.createAmendment` clones the original entry and takes only
// the reason; wizard body edits are silently dropped. Showing the full
// site/employer/when/hours/work-types editors would mislead the user into
// thinking those edits stick. Instead we show a read-only summary of the
// original and capture only the amendment reason. The user lands on the new
// draft's EntryDetail and can use Edit Entry to actually change body fields
// (which routes through edit-mode and DOES pass body edits through).
interface AmendFormProps {
  original: Entry | null;
  reason: string;
  onChangeReason: (next: string) => void;
  isSaving: boolean;
  canSave: boolean;
  onSave: () => void;
  // Theme tokens passed in so this stays a sibling component without re-
  // entering ThemeProvider.
  colors: ReturnType<typeof useTheme>['colors'];
  spacing: ReturnType<typeof useTheme>['spacing'];
  typography: ReturnType<typeof useTheme>['typography'];
  radii: ReturnType<typeof useTheme>['radii'];
  borders: ReturnType<typeof useTheme>['borders'];
}

function AmendForm(props: AmendFormProps) {
  const {
    original,
    reason,
    onChangeReason,
    isSaving,
    canSave,
    onSave,
    colors,
    spacing,
    typography,
    radii,
    borders,
  } = props;

  const dateLabel = original
    ? original.date_from === original.date_to
      ? original.date_from
      : `${original.date_from} to ${original.date_to}`
    : '';

  return (
    <>
      <Text style={[typography.title2, { color: colors.textPrimary }]}>
        Amend entry
      </Text>
      <Text style={[typography.body, { color: colors.textSecondary }]}>
        Amending creates a new draft cloned from the original. The original
        stays in your logbook unchanged. After saving, you can edit the new
        draft's details from its entry detail screen.
      </Text>

      {/* Read-only summary of the original entry. */}
      {original && (
        <View
          style={{
            borderWidth: borders.hair,
            borderColor: colors.border,
            borderRadius: radii.md,
            padding: spacing.base,
            backgroundColor: colors.bgSurface,
            gap: spacing.xs,
          }}
        >
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            Original entry
          </Text>
          <Text style={[typography.bodyMed, { color: colors.textPrimary }]}>
            {original.site}
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            {dateLabel} · {original.work_hours} h
          </Text>
        </View>
      )}

      <Textarea
        label="Reason for amendment"
        value={reason}
        onChangeText={onChangeReason}
        placeholder="Why is this entry being amended?"
      />

      <Button
        title="Save amendment"
        variant="primary"
        onPress={onSave}
        disabled={!canSave}
        loading={isSaving}
      />
    </>
  );
}
