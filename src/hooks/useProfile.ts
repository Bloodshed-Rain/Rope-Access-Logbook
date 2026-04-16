import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createProfileService } from '../services/profileService';
import { getClient } from '../db/initialize';
import { CreateProfileInput, UpdateProfileInput } from '../types';

function getService() { return createProfileService(getClient()); }

export function useProfile() {
  return useQuery({ queryKey: ['profile'], queryFn: () => getService().getProfile() });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProfileInput) => getService().createProfile(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile'] }),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => getService().updateProfile(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile'] }),
  });
}

export function useUpdateLastBackupAt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (timestamp: string) => getService().updateLastBackupAt(timestamp),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile'] }),
  });
}
