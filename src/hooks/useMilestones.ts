import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createEntriesService } from '../services/entriesService';
import { getClient } from '../db/initialize';
import { useProfile } from './useProfile';
import { SpratLevel } from '../types';

export interface MilestoneProgress {
  currentLevel: SpratLevel;
  hoursAtCurrentLevel: number;
  hoursNeeded: number;
  progress: number; // 0.0 to 1.0
  isEligible: boolean;
  isMaxLevel: boolean;
}

export function useMilestones() {
  const { data: profile, isLoading: isProfileLoading } = useProfile();
  
  const entriesService = useMemo(() => createEntriesService(getClient()), []);
  
  const { data: lifetimeHours, isLoading: isHoursLoading } = useQuery({
    queryKey: ['lifetimeHoursByLevel'],
    queryFn: () => entriesService.getLifetimeHoursByLevel(),
    enabled: !!profile,
  });

  const isLoading = isProfileLoading || isHoursLoading;

  const progress = useMemo<MilestoneProgress | null>(() => {
    if (!profile || !lifetimeHours) return null;
    // Milestone math currently tracks the SPRAT level only. IRATA-only profiles
    // skip this hook (returns null); the dashboard's gauge math covers them.
    if (!profile.holds_sprat || !profile.level) return null;
    const currentLevel = profile.level;
    const hoursAtCurrentLevel = lifetimeHours[currentLevel] ?? 0;
    
    if (currentLevel === 'III') {
      return {
        currentLevel,
        hoursAtCurrentLevel,
        hoursNeeded: 0,
        progress: 1,
        isEligible: false,
        isMaxLevel: true,
      };
    }

    // SPRAT: 500 hrs logged at Level I to test for Level II; 1000 hrs at Level II for Level III.
    const hoursNeeded = currentLevel === 'I' ? 500 : 1000;
    const isEligible = hoursAtCurrentLevel >= hoursNeeded;
    
    return {
      currentLevel,
      hoursAtCurrentLevel,
      hoursNeeded,
      progress: Math.min(hoursAtCurrentLevel / hoursNeeded, 1),
      isEligible,
      isMaxLevel: false,
    };
  }, [profile, lifetimeHours]);

  return {
    progress,
    isLoading,
  };
}
