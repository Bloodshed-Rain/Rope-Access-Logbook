// src/screens/onboarding/types.ts
// Shared state shape for the multi-step onboarding wizard. Spec §3 lines 113-124.
//
// The wizard host (OnboardingScreen) owns this state and dispatches the
// next/back transitions; each step component is a pure render of its slice.

import { CertLevel, CertScheme } from '../../types';

export type OnboardingStep =
  | 'welcome'
  | 'name'
  | 'cert'
  | 'role_fork'
  | 'subscribe'
  | 'cloud_signin';

export interface OnboardingCertSlice {
  held: boolean;
  id: string;
  level: CertLevel | null;
  expires: string;
  cardPhotoUri?: string | null;
}

export interface OnboardingState {
  step: OnboardingStep;
  name: { first: string; last: string };
  certs: {
    sprat: OnboardingCertSlice;
    irata: OnboardingCertSlice;
    primary: CertScheme;
  };
  role: 'tech' | 'supervisor';
  supervisorCertNumber: string;
  directoryVisible: boolean;
}

export const initialOnboardingState: OnboardingState = {
  step: 'welcome',
  name: { first: '', last: '' },
  certs: {
    sprat: { held: false, id: '', level: null, expires: '', cardPhotoUri: null },
    irata: { held: false, id: '', level: null, expires: '', cardPhotoUri: null },
    primary: 'sprat',
  },
  role: 'tech',
  supervisorCertNumber: '',
  directoryVisible: true,
};

// Convenience selector — does the user hold any L3 cert?  Determines whether
// the role_fork step is shown after the cert step.
export function hasAnyL3(state: OnboardingState): boolean {
  return (
    (state.certs.sprat.held && state.certs.sprat.level === 'III') ||
    (state.certs.irata.held && state.certs.irata.level === 'III')
  );
}
