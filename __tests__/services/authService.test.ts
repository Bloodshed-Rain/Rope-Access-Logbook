import { createMockCloudClient } from '../cloudMock';
import { createAuthService } from '../../src/services/authService';

describe('authService', () => {
  it('signs in with magic link (mock returns immediately)', async () => {
    const cloud = createMockCloudClient();
    const auth = createAuthService(cloud);
    await auth.signInWithMagicLink('tech@example.com');
    const session = await auth.getSession();
    expect(session).not.toBeNull();
    expect(session!.email).toBe('tech@example.com');
  });

  it('signs out clears the session', async () => {
    const cloud = createMockCloudClient();
    const auth = createAuthService(cloud);
    await auth.signInWithMagicLink('tech@example.com');
    await auth.signOut();
    expect(await auth.getSession()).toBeNull();
  });

  it('getSession returns null when not signed in', async () => {
    const cloud = createMockCloudClient();
    const auth = createAuthService(cloud);
    expect(await auth.getSession()).toBeNull();
  });

  it('signs in with provider', async () => {
    const cloud = createMockCloudClient();
    const auth = createAuthService(cloud);
    const session = await auth.signInWithProvider('google');
    expect(session.user_id).toBe('mock-user-google');
  });

  it('deleteAccount calls delete-account edge function and clears session', async () => {
    const cloud = createMockCloudClient();
    const auth = createAuthService(cloud);
    await auth.signInWithMagicLink('tech@example.com');
    cloud.storage.set('mock-user-email-tech@example.com/snapshot.json', new Uint8Array([1, 2, 3]));
    await auth.deleteAccount();
    expect(cloud.edgeFunctionCalls[0]?.name).toBe('delete-account');
    expect(await auth.getSession()).toBeNull();
    expect(cloud.storage.has('mock-user-email-tech@example.com/snapshot.json')).toBe(false);
  });

  it('onAuthStateChange fires on sign-in and sign-out', async () => {
    const cloud = createMockCloudClient();
    const auth = createAuthService(cloud);
    const events: Array<string | null> = [];
    const unsub = auth.onAuthStateChange((s) => events.push(s?.user_id ?? null));
    await auth.signInWithMagicLink('tech@example.com');
    await auth.signOut();
    unsub();
    expect(events).toEqual(['mock-user-email-tech@example.com', null]);
  });
});
