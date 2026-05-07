// src/screens/EditGearScreen.tsx
//
// Form for editing an existing (non-retired) gear item.

import React from 'react';
import { Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, LoadingSpinner, useToast } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { GearForm } from '../components/GearForm';
import { useGearItem, useUpdateGear } from '../hooks/useGear';
import { useReadOnly } from '../hooks/useSubscription';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'EditGear'>;

export function EditGearScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { gearId } = route.params;
  const { data: item, isLoading } = useGearItem(gearId);
  const update = useUpdateGear();
  const toast = useToast();
  const readOnly = useReadOnly();

  React.useEffect(() => {
    if (readOnly) navigation.replace('Paywall');
  }, [readOnly, navigation]);

  if (isLoading || !item) return <LoadingSpinner fullScreen label="Loading gear" />;

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: spacing.base, paddingTop: spacing.base }}>
        <Text style={[typography.title1, { color: colors.textPrimary }]}>Edit gear</Text>
      </View>
      <GearForm
        initial={item}
        submitLabel="Save changes"
        submitting={update.isPending}
        readOnly={readOnly}
        onCancel={() => navigation.goBack()}
        onSubmit={(input) => {
          // Authoritative gate alongside the mount-time redirect — a lapse
          // arriving after first paint shouldn't allow a slipped-through
          // mutation before the effect remounts.
          if (readOnly) {
            navigation.navigate('Paywall');
            return;
          }
          update.mutate(
            { id: item.id, input },
            {
              onSuccess: () => {
                toast.show({ message: 'Gear updated.', variant: 'ok' });
                navigation.goBack();
              },
              onError: (e) => toast.show({ message: (e as Error).message, variant: 'err' }),
            },
          );
        }}
      />
    </Screen>
  );
}
