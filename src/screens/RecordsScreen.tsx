// src/screens/RecordsScreen.tsx
// Records tab — replaces the old LogbookList stack route. Header + search +
// single-select chip filter + advanced funnel sheet + month-grouped list.
// All filtering is in-memory over `useEntries()`; no SQL changes.

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SectionList,
  Text,
  TextInput,
  TextStyle,
  View,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { ChevronRight, SlidersHorizontal, Search as SearchIcon, Plus } from 'lucide-react-native';
import { Screen, Button, Banner } from '../primitives';
import { FilterChips, Sheet, StatusPill, MultiSelectListRow } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useEntries } from '../hooks/useEntries';
import { useReadOnly } from '../hooks/useSubscription';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { classifyEntry, pillFor } from '../utils/entryStatusPill';
import { formatEntryDateRange, toISODate, fromISODate } from '../utils/dateRange';
import { TechSittingIllustration } from '../components/illustrations/TechSittingIllustration';
import { WORK_TYPE_LABELS } from '../constants';
import { Entry, WorkType, CertLevel } from '../types';
import { RootStackParamList, ChipKey } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type RecordsRoute = RouteProp<{ Records: { filter?: ChipKey } | undefined }, 'Records'>;

// Chip ↔ status mapping. Keep label and key in parallel so we can drive the
// FilterChips primitive (label-based) and the per-entry classifier (key-based)
// from one source.
const CHIP_DEFS: Array<{ key: ChipKey; label: string }> = [
  { key: 'all',              label: 'All' },
  { key: 'drafts',           label: 'Drafts' },
  { key: 'needs_signature',  label: 'Needs signature' },
  { key: 'awaiting',         label: 'Awaiting' },
  { key: 'signed',           label: 'Signed' },
];
const CHIP_LABELS = CHIP_DEFS.map((c) => c.label);
const KEY_BY_LABEL = Object.fromEntries(CHIP_DEFS.map((c) => [c.label, c.key])) as Record<string, ChipKey>;
const LABEL_BY_KEY = Object.fromEntries(CHIP_DEFS.map((c) => [c.key, c.label])) as Record<ChipKey, string>;

// classifyEntry / pillFor live in src/utils/entryStatusPill.ts so EntryDetail
// shares the same source.

interface AdvancedFilters {
  dateFrom: string | null;   // ISO YYYY-MM-DD
  dateTo: string | null;
  workTypes: WorkType[];
  employers: string[];
  certLevels: CertLevel[];
}

const EMPTY_FILTERS: AdvancedFilters = {
  dateFrom: null,
  dateTo: null,
  workTypes: [],
  employers: [],
  certLevels: [],
};

const ALL_WORK_TYPES: WorkType[] = [
  'inspection', 'ndt', 'welding', 'painting', 'window_cleaning',
  'rescue', 'training', 'rigging', 'other',
];

const ALL_CERT_LEVELS: CertLevel[] = ['I', 'II', 'III'];

const MONTH_TITLE_FMT = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

interface MonthSection {
  title: string;
  sortKey: number;       // YYYY*100+MM, descending
  data: Entry[];
}

export function RecordsScreen() {
  const { colors, spacing, typography, radii, borders } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<RecordsRoute>();

  const { data: entries = [], isLoading } = useEntries();
  const readOnly = useReadOnly();

  // Lapsed users tapping the "+ Add work" / FAB / first-entry CTA get
  // bounced to Paywall. Records itself stays fully readable in lapse mode
  // (browsing existing logs is not a write action).
  const handleAddWork = () => {
    if (readOnly) {
      navigation.navigate('Paywall');
      return;
    }
    navigation.navigate('EntryForm', {});
  };

  const [chipKey, setChipKey] = useState<ChipKey>(route.params?.filter ?? 'all');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 200);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [advanced, setAdvanced] = useState<AdvancedFilters>(EMPTY_FILTERS);
  // Draft state inside the sheet — only committed to `advanced` on Apply.
  const [sheetDraft, setSheetDraft] = useState<AdvancedFilters>(EMPTY_FILTERS);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  // Pick up deep-link filter changes when this screen is focused (e.g. Today's
  // "Needs signature" card navigates here with { filter: 'needs_signature' }).
  // Clear the param after consuming so a later return-to-tab doesn't snap the
  // chip back to the deep-link value when the user has manually changed it.
  useFocusEffect(
    useCallback(() => {
      if (route.params?.filter) {
        setChipKey(route.params.filter);
        navigation.setParams({ filter: undefined });
      }
    }, [route.params?.filter, navigation]),
  );

  // Distinct employers across all entries — used for the multi-select picker.
  const distinctEmployers = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      const v = e.employer.trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort();
  }, [entries]);

  const totalEntryCount = entries.length;

  // Filter pipeline: chip → search → advanced filters. AND across all.
  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return entries.filter((e) => {
      // Chip
      if (chipKey !== 'all' && classifyEntry(e) !== chipKey) return false;

      // Search
      if (q.length > 0) {
        const wtText = e.work_types
          .map((t) => WORK_TYPE_LABELS[t] ?? t)
          .join(' ')
          .toLowerCase();
        const haystack = `${e.site} ${e.employer} ${e.description} ${wtText}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      // Advanced — date range
      if (advanced.dateFrom && e.date_to < advanced.dateFrom) return false;
      if (advanced.dateTo && e.date_from > advanced.dateTo) return false;

      // Advanced — work types (any-of)
      if (advanced.workTypes.length > 0) {
        const overlap = e.work_types.some((t) => advanced.workTypes.includes(t));
        if (!overlap) return false;
      }

      // Advanced — employers (any-of)
      if (advanced.employers.length > 0) {
        if (!advanced.employers.includes(e.employer.trim())) return false;
      }

      // Advanced — cert level
      if (advanced.certLevels.length > 0) {
        if (!advanced.certLevels.includes(e.tech_level_snapshot as CertLevel)) return false;
      }

      return true;
    });
  }, [entries, chipKey, debouncedQuery, advanced]);

  // Group filtered entries by month, descending.
  const sections: MonthSection[] = useMemo(() => {
    const map = new Map<number, MonthSection>();
    for (const e of filtered) {
      const parts = e.date_from.split('-');
      if (parts.length < 2) continue;
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (Number.isNaN(y) || Number.isNaN(m)) continue;
      const sortKey = y * 100 + m;
      let s = map.get(sortKey);
      if (!s) {
        // Use a date in the middle of the month so DST never shifts it.
        const title = MONTH_TITLE_FMT.format(new Date(y, m - 1, 15));
        s = { title, sortKey, data: [] };
        map.set(sortKey, s);
      }
      s.data.push(e);
    }
    const out = Array.from(map.values());
    out.sort((a, b) => b.sortKey - a.sortKey);
    // Within each month: most recent date_from first.
    for (const s of out) {
      s.data.sort((a, b) => (b.date_from < a.date_from ? -1 : b.date_from > a.date_from ? 1 : 0));
    }
    return out;
  }, [filtered]);

  const filtersAreActive =
    chipKey !== 'all' ||
    debouncedQuery.trim().length > 0 ||
    advanced.dateFrom !== null ||
    advanced.dateTo !== null ||
    advanced.workTypes.length > 0 ||
    advanced.employers.length > 0 ||
    advanced.certLevels.length > 0;

  const advancedActiveCount =
    (advanced.dateFrom || advanced.dateTo ? 1 : 0) +
    (advanced.workTypes.length > 0 ? 1 : 0) +
    (advanced.employers.length > 0 ? 1 : 0) +
    (advanced.certLevels.length > 0 ? 1 : 0);

  const clearAllFilters = useCallback(() => {
    setChipKey('all');
    setQuery('');
    setAdvanced(EMPTY_FILTERS);
    setSheetDraft(EMPTY_FILTERS);
  }, []);

  const openSheet = () => {
    setSheetDraft(advanced);
    setSheetOpen(true);
  };
  const closeSheet = () => setSheetOpen(false);
  const applySheet = () => {
    setAdvanced(sheetDraft);
    setSheetOpen(false);
  };
  const resetSheet = () => setSheetDraft(EMPTY_FILTERS);

  const renderRow = ({ item }: { item: Entry }) => {
    const cls = classifyEntry(item);
    const pill = pillFor(item, cls);
    const dateRangeText = formatEntryDateRange(item.date_from, item.date_to || item.date_from);
    // TODO: surface supervisor name + level chip on Awaiting/Signed rows once
    // the supervisor display name is reliably available without parsing
    // sign_requests_cache payload JSON. Spec §5 line 235.
    return (
      <Pressable
        onPress={() => navigation.navigate('EntryDetail', { entryId: item.id })}
        accessibilityRole="button"
        accessibilityLabel={`${item.site || 'No site'}, ${dateRangeText}, ${item.work_hours} hours, ${pill.label}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.base,
          paddingVertical: spacing.md,
          backgroundColor: pressed ? colors.bgMuted : colors.bgSurface,
          borderBottomWidth: borders.hair,
          borderBottomColor: colors.divider,
          minHeight: 64,
        })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={[typography.bodyMed, { color: colors.textPrimary }]}
            numberOfLines={1}
          >
            {item.site || '(no site)'}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>
            {dateRangeText}
            <Text style={{ color: colors.textDisabled }}>{`  ·  ${item.work_hours}h`}</Text>
          </Text>
        </View>
        <View style={{ marginLeft: spacing.sm, alignItems: 'flex-end', gap: spacing.xs }}>
          <StatusPill variant={pill.variant} label={pill.label} />
        </View>
        <View style={{ marginLeft: spacing.sm }}>
          <ChevronRight size={20} color={colors.textDisabled} />
        </View>
      </Pressable>
    );
  };

  const renderSectionHeader = ({ section }: { section: MonthSection }) => (
    <View
      style={{
        backgroundColor: colors.bgApp,
        paddingHorizontal: spacing.base,
        paddingTop: spacing.md,
        paddingBottom: spacing.xs,
      }}
    >
      <Text style={[typography.label, { color: colors.textSecondary }]}>{section.title}</Text>
    </View>
  );

  // Empty states
  const showFullEmpty = !isLoading && totalEntryCount === 0;
  const showFilteredEmpty = !isLoading && totalEntryCount > 0 && filtered.length === 0;

  return (
    <Screen padded={false}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: spacing.base,
          paddingTop: spacing.md,
          paddingBottom: spacing.sm,
        }}
      >
        <Text style={[typography.title1, { color: colors.textPrimary }]}>Records</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Advanced filters"
          accessibilityState={{ expanded: sheetOpen }}
          onPress={openSheet}
          hitSlop={12}
          style={{
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SlidersHorizontal color={colors.textPrimary} size={22} />
          {advancedActiveCount > 0 && (
            <View
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 8,
                height: 8,
                borderRadius: radii.pill,
                backgroundColor: colors.accentPrimary,
              }}
            />
          )}
        </Pressable>
      </View>

      {/* Search */}
      <View style={{ paddingHorizontal: spacing.base, paddingBottom: spacing.sm }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.bgMuted,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
            minHeight: 44,
          }}
        >
          <SearchIcon size={18} color={colors.textDisabled} />
          {/* Plain TextInput — the Input primitive comes with a label; spec §5
              says "full-width input under the header" without a label. */}
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <SearchTextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search records"
              placeholderTextColor={colors.textDisabled}
              textColor={colors.textPrimary}
              fontStyle={typography.body}
            />
          </View>
        </View>
      </View>

      {/* Chips */}
      <View style={{ paddingBottom: spacing.sm }}>
        <FilterChips
          chips={CHIP_LABELS}
          selectedChip={LABEL_BY_KEY[chipKey]}
          onSelectChip={(label) => setChipKey(KEY_BY_LABEL[label] ?? 'all')}
        />
      </View>

      {/* Read-only banner — lapsed subscription. Sits above the body so
          it survives both the empty and section-list states. */}
      {readOnly && (
        <View style={{ paddingHorizontal: spacing.base, paddingBottom: spacing.sm }}>
          <Banner
            variant="warning"
            message="Subscription lapsed — renew to add new entries"
            actionLabel="Renew"
            onAction={() => navigation.navigate('Paywall')}
          />
        </View>
      )}

      {/* Body */}
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accentPrimary} />
        </View>
      ) : showFullEmpty ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: spacing.xl,
            gap: spacing.lg,
          }}
        >
          <TechSittingIllustration />
          <Text
            style={[
              typography.title2,
              { color: colors.textPrimary, textAlign: 'center' },
            ]}
          >
            No records yet
          </Text>
          <Button title="+ Log your first entry" variant="primary" onPress={handleAddWork} />
        </View>
      ) : showFilteredEmpty ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: spacing.xl,
            gap: spacing.md,
          }}
        >
          <Text
            style={[
              typography.body,
              { color: colors.textSecondary, textAlign: 'center' },
            ]}
          >
            No records match these filters
          </Text>
          <Button title="Clear filters" variant="ghost" onPress={clearAllFilters} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
        />
      )}

      {/* Floating + button: only when at least one entry exists */}
      {totalEntryCount > 0 && (
        <Pressable
          onPress={handleAddWork}
          accessibilityRole="button"
          accessibilityLabel="New entry"
          style={({ pressed }) => ({
            position: 'absolute',
            right: spacing.base,
            bottom: spacing.lg,
            width: 56,
            height: 56,
            borderRadius: radii.pill,
            backgroundColor: pressed ? colors.accentPressed : colors.accentPrimary,
            alignItems: 'center',
            justifyContent: 'center',
            ...(Platform.OS === 'ios'
              ? { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }
              : { elevation: 4 }),
          })}
        >
          <Plus size={28} color={colors.textInverse} />
        </Pressable>
      )}

      {/* Funnel sheet */}
      <Sheet open={sheetOpen} onClose={closeSheet} title="Filters" scrollable>
        <View style={{ gap: spacing.lg }}>
          {/* Date range */}
          <View style={{ gap: spacing.sm }}>
            <Text style={[typography.label, { color: colors.textSecondary }]}>Date range</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Pressable
                onPress={() => setShowFromPicker(true)}
                style={{
                  flex: 1,
                  borderWidth: borders.hair,
                  borderColor: colors.border,
                  borderRadius: radii.md,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.md,
                  backgroundColor: colors.bgSurface,
                  minHeight: 44,
                  justifyContent: 'center',
                }}
              >
                <Text style={[typography.caption, { color: colors.textSecondary }]}>From</Text>
                <Text style={[typography.body, { color: colors.textPrimary }]}>
                  {sheetDraft.dateFrom ?? 'Any'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setShowToPicker(true)}
                style={{
                  flex: 1,
                  borderWidth: borders.hair,
                  borderColor: colors.border,
                  borderRadius: radii.md,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.md,
                  backgroundColor: colors.bgSurface,
                  minHeight: 44,
                  justifyContent: 'center',
                }}
              >
                <Text style={[typography.caption, { color: colors.textSecondary }]}>To</Text>
                <Text style={[typography.body, { color: colors.textPrimary }]}>
                  {sheetDraft.dateTo ?? 'Any'}
                </Text>
              </Pressable>
            </View>
            {(sheetDraft.dateFrom || sheetDraft.dateTo) && (
              <Pressable
                onPress={() => setSheetDraft((d) => ({ ...d, dateFrom: null, dateTo: null }))}
                accessibilityRole="button"
              >
                <Text style={[typography.caption, { color: colors.accentPrimary }]}>
                  Clear date range
                </Text>
              </Pressable>
            )}
            {showFromPicker && (
              <DateTimePicker
                value={fromISODate(sheetDraft.dateFrom)}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(_e: DateTimePickerEvent, d?: Date) => {
                  if (Platform.OS !== 'ios') setShowFromPicker(false);
                  if (d) setSheetDraft((cur) => ({ ...cur, dateFrom: toISODate(d) }));
                }}
              />
            )}
            {showToPicker && (
              <DateTimePicker
                value={fromISODate(sheetDraft.dateTo)}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(_e: DateTimePickerEvent, d?: Date) => {
                  if (Platform.OS !== 'ios') setShowToPicker(false);
                  if (d) setSheetDraft((cur) => ({ ...cur, dateTo: toISODate(d) }));
                }}
              />
            )}
          </View>

          {/* Work types */}
          <View style={{ gap: spacing.sm }}>
            <Text style={[typography.label, { color: colors.textSecondary }]}>Work types</Text>
            <View
              style={{
                borderWidth: borders.hair,
                borderColor: colors.border,
                borderRadius: radii.md,
                overflow: 'hidden',
                backgroundColor: colors.bgSurface,
              }}
            >
              {ALL_WORK_TYPES.map((wt) => (
                <MultiSelectListRow
                  key={wt}
                  label={WORK_TYPE_LABELS[wt]}
                  selected={sheetDraft.workTypes.includes(wt)}
                  onToggle={() =>
                    setSheetDraft((cur) => ({
                      ...cur,
                      workTypes: cur.workTypes.includes(wt)
                        ? cur.workTypes.filter((x) => x !== wt)
                        : [...cur.workTypes, wt],
                    }))
                  }
                />
              ))}
            </View>
          </View>

          {/* Employer multi-select */}
          {distinctEmployers.length > 0 && (
            <View style={{ gap: spacing.sm }}>
              <Text style={[typography.label, { color: colors.textSecondary }]}>Employer</Text>
              <View
                style={{
                  borderWidth: borders.hair,
                  borderColor: colors.border,
                  borderRadius: radii.md,
                  overflow: 'hidden',
                  backgroundColor: colors.bgSurface,
                }}
              >
                {distinctEmployers.map((emp) => (
                  <MultiSelectListRow
                    key={emp}
                    label={emp}
                    selected={sheetDraft.employers.includes(emp)}
                    onToggle={() =>
                      setSheetDraft((cur) => ({
                        ...cur,
                        employers: cur.employers.includes(emp)
                          ? cur.employers.filter((x) => x !== emp)
                          : [...cur.employers, emp],
                      }))
                    }
                  />
                ))}
              </View>
            </View>
          )}

          {/* Cert level chip group */}
          <View style={{ gap: spacing.sm }}>
            <Text style={[typography.label, { color: colors.textSecondary }]}>Cert level</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {ALL_CERT_LEVELS.map((lvl) => {
                const selected = sheetDraft.certLevels.includes(lvl);
                return (
                  <Pressable
                    key={lvl}
                    onPress={() =>
                      setSheetDraft((cur) => ({
                        ...cur,
                        certLevels: cur.certLevels.includes(lvl)
                          ? cur.certLevels.filter((x) => x !== lvl)
                          : [...cur.certLevels, lvl],
                      }))
                    }
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={{
                      flex: 1,
                      paddingVertical: spacing.md,
                      borderRadius: radii.md,
                      borderWidth: borders.hair,
                      borderColor: selected ? colors.accentPrimary : colors.border,
                      backgroundColor: selected ? colors.accentPrimary : colors.bgSurface,
                      alignItems: 'center',
                    }}
                  >
                    <Text
                      style={[
                        typography.label,
                        { color: selected ? colors.textInverse : colors.textPrimary },
                      ]}
                    >
                      {`Level ${lvl}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Actions */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Button title="Reset filters" variant="ghost" onPress={resetSheet} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Apply" variant="primary" onPress={applySheet} />
            </View>
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}

// Wrapper around RN's TextInput so the search row can use the theme tokens
// without bringing in the labeled `Input` primitive (spec calls for an
// unlabeled search input). Kept colocated to avoid creating yet another
// primitive file.
function SearchTextInput(props: {
  value: string;
  onChangeText: (s: string) => void;
  placeholder: string;
  placeholderTextColor: string;
  textColor: string;
  fontStyle: TextStyle;
}) {
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor={props.placeholderTextColor}
      style={[props.fontStyle, { color: props.textColor, paddingVertical: 0 }]}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="search"
      accessibilityLabel="Search records"
    />
  );
}
