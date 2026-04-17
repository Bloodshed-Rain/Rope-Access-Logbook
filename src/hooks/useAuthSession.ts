// src/hooks/useAuthSession.ts
import { useEffect, useState } from 'react';
import { AuthSession } from '../types';
import { createAuthService } from '../services/authService';
import { CloudClient } from '../cloud/cloudClient';

export function useAuthSession(cloud: CloudClient) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = createAuthService(cloud);
    let cancelled = false;

    auth.getSession()
      .then((s) => {
        if (!cancelled) {
          setSession(s);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    const unsub = auth.onAuthStateChange((s) => {
      if (!cancelled) setSession(s);
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [cloud]);

  return { session, loading, isSignedIn: session !== null };
}
