// src/screens/AddGearScreen.tsx
//
// Form for creating a new gear item. Shares the GearForm component with
// EditGearScreen.

import React from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, useToast } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { GearForm } from '../components/GearForm';
import { useCreateGear } from '../hooks/useGear';
import { useReadOnly } from '../hooks/useSubscription';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function AddGearScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const create = useCreateGear();
  const toast = useToast();
  const readOnly = useReadOnly();

  // Lapsed users shouldn't reach this screen — the entry CTAs gate on
  // useReadOnly(). Belt-and-braces: bounce to Paywall if they get here anyway.
  React.useEffect(() => {
    if (readOnly) navigation.replace('Paywall');
  }, [readOnly, navigation]);

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: spacing.base, paddingTop: spacing.base }}>
        <Text style={[typography.title1, { color: colors.textPrimary }]}>Add gear</Text>
      </View>
      <GearForm
        submitLabel="Save"
        submitting={create.isPending}
        readOnly={readOnly}
        onCancel={() => navigation.goBack()}
        onSubmit={(input) => {
          // Authoritative gate. Defense-in-depth alongside the mount-time
          // useEffect redirect — a status flip after mount must not slip a
          // write through before the redirect remounts.
          if (readOnly) {
            navigation.navigate('Paywall');
            return;
          }
          create.mutate(input, {
            onSuccess: () => {
              toast.show({ message: 'Gear added.', variant: 'ok' });
              navigation.goBack();
            },
            onError: (e) => toast.show({ message: (e as Error).message, variant: 'err' }),
          });
        }}
      />
    </Screen>
  );
}
