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
  
  const { data: lifetimeHours, isLoading: isHoursLoading } = useQuery({
    queryKey: ['lifetimeHoursByLevel'],
    // getClient() is called inside queryFn (not at render time) so it only runs
    // after the DB is guaranteed to be initialised and the query is enabled.
    queryFn: () => createEntriesService(getClient()).getLifetimeHoursByLevel(),
    enabled: !!profile,
  });

  const isLoading = isProfileLoading || isHoursLoading;

  const progress = useMemo<MilestoneProgress | null>(() => {
    if (!profile || !lifetimeHours) return null;

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
