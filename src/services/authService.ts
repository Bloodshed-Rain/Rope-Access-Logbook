// src/services/authService.ts
import { CloudClient, AuthProvider } from '../cloud/cloudClient';
import { AuthSession } from '../types';

export interface AuthServiceDeps {
  cloud: CloudClient;
}

export function createAuthService(cloud: CloudClient) {
  return {
    async signInWithMagicLink(email: string): Promise<void> {
      await cloud.signInWithMagicLink(email);
    },
    async signInWithProvider(provider: AuthProvider): Promise<AuthSession> {
      return cloud.signInWithProvider(provider);
    },
    async signOut(): Promise<void> {
      await cloud.signOut();
    },
    async getSession(): Promise<AuthSession | null> {
      return cloud.getSession();
    },
    onAuthStateChange(callback: (session: AuthSession | null) => void): () => void {
      return cloud.onAuthStateChange(callback);
    },
    async deleteAccount(): Promise<void> {
      await cloud.callEdgeFunction('delete-account');
    },
  };
}
