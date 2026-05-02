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
import { Screen, LoadingSpinner } from '../primitives';
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
  const { colors, spacing, typography, radii } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<FormRoute>();

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

  const isDirty = useMemo(() => !statesEqual(state, initial), [state, initial]);

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
    (!state.workTypes.includes('other') || state.otherWorkDescription.trim().length > 0) &&
    (!isAmend || state.amendmentReason.trim().length > 0);

  const isSaving =
    createEntry.isPending || updateEntry.isPending || createAmendment.isPending;

  const handleSave = async () => {
    if (!profile) return;
    if (!step1Valid || !step2Valid) return;

    const otherText = state.workTypes.includes('other') && state.otherWorkDescription.trim()
      ? state.otherWorkDescription.trim()
      : null;
    const techLevel = profile.level ?? 'I';

    let savedId: string;
    if (isAmend && amendId) {
      // Amend: createAmendment clones the original. Preserves existing
      // semantics — the wizard's edits to the body are discarded; only the
      // reason is taken. The new draft is what the user then edits via
      // EntryDetail → "Edit Entry".
      const amendment = await createAmendment.mutateAsync({
        entryId: amendId,
        reason: state.amendmentReason.trim(),
        techLevel,
      });
      savedId = amendment.id;
    } else if (isEdit && editId) {
      await updateEntry.mutateAsync({
        id: editId,
        input: {
          date_from: state.dateFrom,
          date_to: state.dateTo,
          employer: state.employer.trim(),
          site: state.site.trim(),
          // Preserved-but-hidden fields pass through unchanged.
          client: state.client,
          description: state.notes,
          work_hours: hoursNum,
          work_types: state.workTypes,
          other_work_description: otherText,
          equipment_notes: state.equipmentNotes || null,
          weather: state.weather || null,
          photo_paths: state.photoPaths,
        },
      });
      savedId = editId;
    } else {
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

    isLeavingIntentionally.current = true;
    // TODO(D2): swap this for the PostSaveSheet handoff.
    navigation.replace('EntryDetail', { entryId: savedId });
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

      {/* Progress strip */}
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
            {step === 1 ? (
              <Step1
                state={state}
                update={update}
                setState={setState}
                isAmend={isAmend}
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
