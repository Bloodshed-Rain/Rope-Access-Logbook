import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BookOpen, User } from 'lucide-react-native';
import { useProfile } from '../hooks/useProfile';
import { colors } from '../theme/tokens';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { LogbookScreen } from '../screens/LogbookScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { EntryFormScreen } from '../screens/EntryFormScreen';
import { EntryDetailScreen } from '../screens/EntryDetailScreen';
import { SignatureScreen } from '../screens/SignatureScreen';

export type RootStackParamList = {
  Onboarding: undefined;
  Main: undefined;
  EntryForm: { entryId?: string; amendEntryId?: string } | undefined;
  EntryDetail: { entryId: string };
  Signature: { entryId: string };
};

export type TabParamList = { Logbook: undefined; Profile: undefined; };

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function TabNavigator() {
  return (
    <Tab.Navigator screenOptions={{
      tabBarActiveTintColor: colors.accent, tabBarInactiveTintColor: colors.textTertiary,
      tabBarStyle: { borderTopColor: colors.border }, headerShown: false }}>
      <Tab.Screen name="Logbook" component={LogbookScreen}
        options={{ tabBarIcon: ({ color, size }) => <BookOpen color={color} size={size} /> }} />
      <Tab.Screen name="Profile" component={ProfileScreen}
        options={{ tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { data: profile, isLoading } = useProfile();
  if (isLoading) return null;
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!profile ? (
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        ) : (
          <>
            <Stack.Screen name="Main" component={TabNavigator} />
            <Stack.Screen name="EntryForm" component={EntryFormScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="EntryDetail" component={EntryDetailScreen} />
            <Stack.Screen name="Signature" component={SignatureScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
