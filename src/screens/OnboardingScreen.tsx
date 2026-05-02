// src/screens/OnboardingScreen.tsx
// Multi-step onboarding wizard host. Spec §3 lines 113-124. Plan task E1.
//
// Single mounted screen — internal `step` state drives which sub-step renders.
// Keeping the wizard in one stack route avoids losing form state on navigation
// (the magic-link path navigates to MagicLinkWait, which pops back here with
// our state intact). Hardware-back is intercepted to step backward; from
// `welcome` it falls through and exits the app, matching native onboarding
// expectations.
//
// Profile creation is the final side-effect, fired only after all required
// steps resolve. Per spec §3 line 124, supervisors hit cloud_signin BEFORE
// subscribe (you can't be in the directory without a Supabase account), so
// the auth session is already established when finishOnboarding fires:
//   - tech path:   subscribe → createProfile → done
//   - supervisor:  cloud_signin → subscribe → createProfile →
//                  enableSupervisorCapability → done
// Subscription status is re-synced post-create so the just-purchased trial is
// reflected in `profile.subscription_status` (purchase() runs an UPDATE, which
// is a no-op until a profile row exists).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, BackHandler } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../primitives';
import { useCreateProfile } from '../hooks/useProfile';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createProfileService } from '../services/profileService';
import { createSubscriptionService } from '../services/subscriptionService';
import { getClient } from '../db/initialize';
import { CertBlockInput, CreateProfileInput } from '../types';
import {
  OnboardingState,
  hasAnyL3,
  initialOnboardingState,
} from './onboarding/types';
import { WelcomeStep } from './onboarding/WelcomeStep';
import { NameStep } from './onboarding/NameStep';
import { CertStep } from './onboarding/CertStep';
import { RoleForkStep } from './onboarding/RoleForkStep';
import { SubscribeStep } from './onboarding/SubscribeStep';
import { CloudSignInStep } from './onboarding/CloudSignInStep';

export function OnboardingScreen() {
  const [state, setState] = useState<OnboardingState>(initialOnboardingState);
  const [completing, setCompleting] = useState(false);
  const createProfile = useCreateProfile();
  const queryClient = useQueryClient();
  const toast = useToast();
  const cloud = useMemo(() => createSupabaseCloudClient(), []);

  // Derived: skip role_fork unless any cert is L3.
  const showRoleFork = hasAnyL3(state);

  const goTo = (step: OnboardingState['step']) =>
    setState((s) => ({ ...s, step }));

  const goBack = useCallback(() => {
    setState((s) => {
      switch (s.step) {
        case 'welcome':
          return s;
        case 'name':
          return { ...s, step: 'welcome' };
        case 'cert':
          return { ...s, step: 'name' };
        case 'role_fork':
          return { ...s, step: 'cert' };
        case 'subscribe':
          // Supervisor path: subscribe came after cloud_signin.
          // Tech path: subscribe came after role_fork (if any L3) or cert.
          if (s.role === 'supervisor') return { ...s, step: 'cloud_signin' };
          return { ...s, step: hasAnyL3(s) ? 'role_fork' : 'cert' };
        case 'cloud_signin':
          // Only supervisors reach cloud_signin, and the supervisor path
          // requires role_fork to choose the role — so back always goes there.
          return { ...s, step: 'role_fork' };
        default:
          return s;
      }
    });
  }, []);

  // Hardware back: step backward unless we're on welcome.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state.step === 'welcome') return false;
      goBack();
      return true;
    });
    return () => sub.remove();
  }, [state.step, goBack]);

  // Build CreateProfileInput from captured state. Throws if no cert held —
  // the cert step's "Continue" gate guarantees this can't happen at runtime.
  function buildProfileInput(s: OnboardingState): CreateProfileInput {
    const fullName = `${s.name.first.trim()} ${s.name.last.trim()}`.trim();
    const sprat: CertBlockInput | undefined =
      s.certs.sprat.held && s.certs.sprat.level
        ? {
            id: s.certs.sprat.id.trim(),
            level: s.certs.sprat.level,
            cert_expires_on: s.certs.sprat.expires,
            card_photo_path: s.certs.sprat.cardPhotoUri ?? null,
          }
        : undefined;
    const irata: CertBlockInput | undefined =
      s.certs.irata.held && s.certs.irata.level
        ? {
            id: s.certs.irata.id.trim(),
            level: s.certs.irata.level,
            cert_expires_on: s.certs.irata.expires,
            card_photo_path: s.certs.irata.cardPhotoUri ?? null,
          }
        : undefined;
    return {
      full_name: fullName,
      sprat,
      irata,
      primary_cert: s.certs.primary,
    };
  }

  // Final commit. Both paths run after subscribe; supervisor path additionally
  // ran cloud_signin before subscribe (so an authed session is already in
  // place, which is required for the supervisor_directory upsert).
  const finishOnboarding = useCallback(async () => {
    if (completing) return;
    setCompleting(true);
    try {
      const input = buildProfileInput(state);
      await createProfile.mutateAsync(input);

      // enableSupervisorCapability has its own try/catch — if the directory
      // upsert fails, the profile row is already created, so we keep the user
      // moving and toast them to finish supervisor setup from the Me tab
      // rather than rolling everything back.
      if (state.role === 'supervisor') {
        try {
          const db = getClient();
          const profileSvc = createProfileService(db);
          await profileSvc.enableSupervisorCapability(
            state.supervisorCertNumber.trim(),
            input.full_name,
            state.directoryVisible,
            cloud,
          );
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[onboarding] enableSupervisorCapability failed', e);
          toast.show({
            message: 'Profile created — finish supervisor setup in Me.',
            variant: 'warn',
          });
        }
      }

      // Re-sync RC status into the just-created profile row so trial state is
      // reflected in subsequent reads (subscriptionService.purchase already
      // ran an UPDATE, but it was a no-op pre-create).
      try {
        await createSubscriptionService(getClient()).getStatus();
      } catch {
        /* offline-tolerant — defaults to 'unknown' */
      }

      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      await queryClient.invalidateQueries({ queryKey: ['subscriptionStatus'] });
      toast.show({ message: 'Profile created', variant: 'ok' });
    } catch (e) {
      const message = (e as Error)?.message ?? 'Could not create profile.';
      Alert.alert('Setup failed', message);
      setCompleting(false);
    }
  }, [completing, state, createProfile, queryClient, toast, cloud]);

  // Stable callbacks for child step components so their useEffects don't
  // re-fire on every parent render. (The `completing` guard inside
  // finishOnboarding still protects correctness; this is defense-in-depth.)
  const handlePurchased = useCallback(() => {
    // Both tech and supervisor paths complete on subscribe — the supervisor
    // already signed in before subscribe per spec §3 line 124.
    finishOnboarding();
  }, [finishOnboarding]);

  const handleSignedIn = useCallback(() => {
    // Only supervisors reach cloud_signin; advance to subscribe.
    setState((s) => ({ ...s, step: 'subscribe' }));
  }, []);

  // Step renderer.
  switch (state.step) {
    case 'welcome':
      return <WelcomeStep onNext={() => goTo('name')} />;

    case 'name':
      return (
        <NameStep
          state={state}
          onChange={(name) => setState((s) => ({ ...s, name }))}
          onBack={goBack}
          onNext={() => goTo('cert')}
        />
      );

    case 'cert':
      return (
        <CertStep
          state={state}
          onChange={(certs) => setState((s) => ({ ...s, certs }))}
          onBack={goBack}
          onNext={() => {
            if (showRoleFork) goTo('role_fork');
            else setState((s) => ({ ...s, role: 'tech', step: 'subscribe' }));
          }}
        />
      );

    case 'role_fork':
      return (
        <RoleForkStep
          state={state}
          onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
          onBack={goBack}
          onNext={() =>
            // Supervisors must sign in before subscribing per spec §3 line 124
            // — directory upsert needs a real Supabase account.
            goTo(state.role === 'supervisor' ? 'cloud_signin' : 'subscribe')
          }
        />
      );

    case 'subscribe':
      return (
        <SubscribeStep
          onBack={goBack}
          onPurchased={handlePurchased}
        />
      );

    case 'cloud_signin':
      return (
        <CloudSignInStep
          onBack={goBack}
          onSignedIn={handleSignedIn}
        />
      );

    default:
      return <WelcomeStep onNext={() => goTo('name')} />;
  }
}
