// __tests__/services/subscriptionService.test.ts
import { createTestClient } from '../setup';
import { createSubscriptionService, deriveStatus, SubscriptionStatus } from '../../src/services/subscriptionService';
import { DbClient } from '../../src/db/client';

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    getCustomerInfo: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
    getOfferings: jest.fn(),
    logIn: jest.fn(),
    logOut: jest.fn(),
  },
}));
import Purchases from 'react-native-purchases';
const mockPurchases = Purchases as jest.Mocked<typeof Purchases>;

function makeCustomerInfo(
  active: Record<string, { periodType: string; expirationDate?: string }>,
  all: Record<string, { periodType: string; expirationDate?: string }>,
) {
  return { entitlements: { active, all } } as any;
}

const SEED_PROFILE = `
  INSERT INTO profile (
    id, full_name, holds_sprat, sprat_id, level, cert_expires_on,
    holds_irata, irata_level, irata_expires_on, primary_cert,
    default_employer, subscription_status, created_at, updated_at
  ) VALUES (
    'p1', 'Test Tech', 1, 'S-001', 'II', '2028-01-01',
    0, NULL, NULL, 'sprat',
    'Acme', 'unknown', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  )
`;

describe('subscriptionService', () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await createTestClient();
    await db.run(SEED_PROFILE);
  });

  describe('getStatus()', () => {
    it('returns "trialing" when active entitlement has periodType TRIAL', async () => {
      mockPurchases.getCustomerInfo.mockResolvedValueOnce(
        makeCustomerInfo(
          { pro: { periodType: 'TRIAL', expirationDate: '2026-06-01T00:00:00Z' } },
          { pro: { periodType: 'TRIAL', expirationDate: '2026-06-01T00:00:00Z' } },
        ),
      );
      const svc = createSubscriptionService(db);
      const status = await svc.getStatus();
      expect(status).toBe('trialing');
    });

    it('returns "trialing" when active entitlement has periodType INTRO', async () => {
      mockPurchases.getCustomerInfo.mockResolvedValueOnce(
        makeCustomerInfo(
          { pro: { periodType: 'INTRO', expirationDate: '2026-06-01T00:00:00Z' } },
          { pro: { periodType: 'INTRO', expirationDate: '2026-06-01T00:00:00Z' } },
        ),
      );
      const svc = createSubscriptionService(db);
      const status = await svc.getStatus();
      expect(status).toBe('trialing');
    });

    it('returns "active" when active entitlement has periodType NORMAL', async () => {
      mockPurchases.getCustomerInfo.mockResolvedValueOnce(
        makeCustomerInfo(
          { pro: { periodType: 'NORMAL', expirationDate: '2026-12-01T00:00:00Z' } },
          { pro: { periodType: 'NORMAL', expirationDate: '2026-12-01T00:00:00Z' } },
        ),
      );
      const svc = createSubscriptionService(db);
      const status = await svc.getStatus();
      expect(status).toBe('active');
    });

    it('returns "lapsed" when entitlement exists in all but not active', async () => {
      mockPurchases.getCustomerInfo.mockResolvedValueOnce(
        makeCustomerInfo(
          {},
          { pro: { periodType: 'NORMAL' } },
        ),
      );
      const svc = createSubscriptionService(db);
      const status = await svc.getStatus();
      expect(status).toBe('lapsed');
    });

    it('returns "unknown" when entitlement is not in all or active', async () => {
      mockPurchases.getCustomerInfo.mockResolvedValueOnce(
        makeCustomerInfo({}, {}),
      );
      const svc = createSubscriptionService(db);
      const status = await svc.getStatus();
      expect(status).toBe('unknown');
    });
  });

  describe('offline fallback', () => {
    it('returns the DB subscription_status when getCustomerInfo throws', async () => {
      await db.run("UPDATE profile SET subscription_status = 'lapsed' WHERE 1=1");
      mockPurchases.getCustomerInfo.mockRejectedValueOnce(new Error('network error'));
      const svc = createSubscriptionService(db);
      const status = await svc.getStatus();
      expect(status).toBe('lapsed');
    });

    it('returns "unknown" when getCustomerInfo throws and no profile exists', async () => {
      await db.run('DELETE FROM profile');
      mockPurchases.getCustomerInfo.mockRejectedValueOnce(new Error('offline'));
      const svc = createSubscriptionService(db);
      const status = await svc.getStatus();
      expect(status).toBe('unknown');
    });

    it('coerces stale "free" value from DB to "unknown"', async () => {
      // Simulate a pre-migration row that somehow still holds 'free'
      await db.run("UPDATE profile SET subscription_status = 'free' WHERE 1=1");
      mockPurchases.getCustomerInfo.mockRejectedValueOnce(new Error('offline'));
      const svc = createSubscriptionService(db);
      const status = await svc.getStatus();
      expect(status).toBe('unknown');
    });
  });

  describe('DB persistence', () => {
    it('mirrors the resolved status into profile.subscription_status', async () => {
      mockPurchases.getCustomerInfo.mockResolvedValueOnce(
        makeCustomerInfo(
          { pro: { periodType: 'NORMAL', expirationDate: '2026-12-01T00:00:00Z' } },
          { pro: { periodType: 'NORMAL', expirationDate: '2026-12-01T00:00:00Z' } },
        ),
      );
      const svc = createSubscriptionService(db);
      await svc.getStatus();
      const row = await db.get<{ subscription_status: string }>(
        'SELECT subscription_status FROM profile LIMIT 1',
      );
      expect(row?.subscription_status).toBe('active');
    });
  });

  describe('getTrialDaysRemaining()', () => {
    it('returns days remaining when currently trialing', async () => {
      const now = new Date('2026-05-01T00:00:00Z');
      jest.useFakeTimers();
      jest.setSystemTime(now);

      // Two calls: one from getStatus() inside getTrialDaysRemaining, one from getCustomerInfo
      const trialInfo = makeCustomerInfo(
        { pro: { periodType: 'TRIAL', expirationDate: '2026-05-11T00:00:00Z' } },
        { pro: { periodType: 'TRIAL', expirationDate: '2026-05-11T00:00:00Z' } },
      );
      mockPurchases.getCustomerInfo.mockResolvedValue(trialInfo);

      const svc = createSubscriptionService(db);
      const days = await svc.getTrialDaysRemaining();
      expect(days).toBe(10);

      jest.useRealTimers();
    });

    it('returns null when status is active (not trialing)', async () => {
      mockPurchases.getCustomerInfo.mockResolvedValue(
        makeCustomerInfo(
          { pro: { periodType: 'NORMAL', expirationDate: '2026-12-01T00:00:00Z' } },
          { pro: { periodType: 'NORMAL', expirationDate: '2026-12-01T00:00:00Z' } },
        ),
      );
      const svc = createSubscriptionService(db);
      const days = await svc.getTrialDaysRemaining();
      expect(days).toBeNull();
    });
  });

  describe('getRenewalDate()', () => {
    it('returns expirationDate ISO string when status is active', async () => {
      mockPurchases.getCustomerInfo.mockResolvedValue(
        makeCustomerInfo(
          { pro: { periodType: 'NORMAL', expirationDate: '2026-12-01T00:00:00Z' } },
          { pro: { periodType: 'NORMAL', expirationDate: '2026-12-01T00:00:00Z' } },
        ),
      );
      const svc = createSubscriptionService(db);
      const renewal = await svc.getRenewalDate();
      expect(renewal).toBe('2026-12-01T00:00:00Z');
    });

    it('returns null when trialing (not active)', async () => {
      mockPurchases.getCustomerInfo.mockResolvedValue(
        makeCustomerInfo(
          { pro: { periodType: 'TRIAL', expirationDate: '2026-05-11T00:00:00Z' } },
          { pro: { periodType: 'TRIAL', expirationDate: '2026-05-11T00:00:00Z' } },
        ),
      );
      const svc = createSubscriptionService(db);
      const renewal = await svc.getRenewalDate();
      expect(renewal).toBeNull();
    });
  });

  describe('identify() — Supabase auth → RevenueCat bridge', () => {
    it('calls Purchases.logIn with the given user id and returns derived status', async () => {
      const activeInfo = makeCustomerInfo(
        { pro: { periodType: 'NORMAL', expirationDate: '2026-12-01T00:00:00Z' } },
        { pro: { periodType: 'NORMAL', expirationDate: '2026-12-01T00:00:00Z' } },
      );
      mockPurchases.logIn.mockResolvedValueOnce({ customerInfo: activeInfo, created: false } as any);
      const svc = createSubscriptionService(db);
      const status = await svc.identify('supabase-user-abc');
      expect(mockPurchases.logIn).toHaveBeenCalledWith('supabase-user-abc');
      expect(status).toBe('active');
    });

    it('mirrors the resolved status into profile.subscription_status after logIn', async () => {
      const trialInfo = makeCustomerInfo(
        { pro: { periodType: 'TRIAL', expirationDate: '2026-06-01T00:00:00Z' } },
        { pro: { periodType: 'TRIAL', expirationDate: '2026-06-01T00:00:00Z' } },
      );
      mockPurchases.logIn.mockResolvedValueOnce({ customerInfo: trialInfo, created: true } as any);
      const svc = createSubscriptionService(db);
      await svc.identify('supabase-user-new');
      const row = await db.get<{ subscription_status: string }>(
        'SELECT subscription_status FROM profile LIMIT 1',
      );
      expect(row?.subscription_status).toBe('trialing');
    });

    it('falls back to offline status resolution when logIn throws', async () => {
      // DB already holds 'lapsed' from a prior session. logIn fails (network),
      // but the user-visible status should still resolve from the persisted
      // value rather than throwing — auth state changes must never break.
      await db.run("UPDATE profile SET subscription_status = 'lapsed' WHERE 1=1");
      mockPurchases.logIn.mockRejectedValueOnce(new Error('network error'));
      mockPurchases.getCustomerInfo.mockRejectedValueOnce(new Error('network error'));
      const svc = createSubscriptionService(db);
      const status = await svc.identify('supabase-user-abc');
      expect(status).toBe('lapsed');
    });
  });

  describe('signOut() — Supabase sign-out → RevenueCat bridge', () => {
    it('calls Purchases.logOut and returns derived status (typically unknown)', async () => {
      const anonInfo = makeCustomerInfo({}, {});
      mockPurchases.logOut.mockResolvedValueOnce(anonInfo as any);
      const svc = createSubscriptionService(db);
      const status = await svc.signOut();
      expect(mockPurchases.logOut).toHaveBeenCalled();
      expect(status).toBe('unknown');
    });

    it('mirrors the post-logOut status into profile.subscription_status', async () => {
      // Seed the DB with a stale 'active' so we can confirm logOut clears it.
      await db.run("UPDATE profile SET subscription_status = 'active' WHERE 1=1");
      const anonInfo = makeCustomerInfo({}, {});
      mockPurchases.logOut.mockResolvedValueOnce(anonInfo as any);
      const svc = createSubscriptionService(db);
      await svc.signOut();
      const row = await db.get<{ subscription_status: string }>(
        'SELECT subscription_status FROM profile LIMIT 1',
      );
      expect(row?.subscription_status).toBe('unknown');
    });

    it('falls back to current resolved status when logOut throws', async () => {
      // Common cause: RC SDK throws when logOut is called while already
      // anonymous. The handler must not propagate the error — auth state
      // changes are best-effort with respect to RC.
      mockPurchases.logOut.mockRejectedValueOnce(new Error('already anonymous'));
      mockPurchases.getCustomerInfo.mockResolvedValueOnce(makeCustomerInfo({}, {}));
      const svc = createSubscriptionService(db);
      const status = await svc.signOut();
      expect(status).toBe('unknown');
    });
  });

  describe('purchase() and restore() DB sync', () => {
    it('purchase() syncs status to DB on TRIAL success', async () => {
      const trialInfo = makeCustomerInfo(
        { pro: { periodType: 'TRIAL', expirationDate: '2026-06-01T00:00:00Z' } },
        { pro: { periodType: 'TRIAL', expirationDate: '2026-06-01T00:00:00Z' } },
      );
      mockPurchases.purchasePackage.mockResolvedValueOnce({ customerInfo: trialInfo } as any);
      const svc = createSubscriptionService(db);
      const status = await svc.purchase({} as any);
      expect(status).toBe('trialing');
      const row = await db.get<{ subscription_status: string }>(
        'SELECT subscription_status FROM profile LIMIT 1',
      );
      expect(row?.subscription_status).toBe('trialing');
    });

    it('restore() syncs status to DB on NORMAL active success', async () => {
      const activeInfo = makeCustomerInfo(
        { pro: { periodType: 'NORMAL', expirationDate: '2026-12-01T00:00:00Z' } },
        { pro: { periodType: 'NORMAL', expirationDate: '2026-12-01T00:00:00Z' } },
      );
      mockPurchases.restorePurchases.mockResolvedValueOnce(activeInfo as any);
      const svc = createSubscriptionService(db);
      const status = await svc.restore();
      expect(status).toBe('active');
      const row = await db.get<{ subscription_status: string }>(
        'SELECT subscription_status FROM profile LIMIT 1',
      );
      expect(row?.subscription_status).toBe('active');
    });
  });
});

describe('deriveStatus', () => {
  test('TRIAL periodType -> trialing', () => {
    const info = { entitlements: { active: { pro: { periodType: 'TRIAL' } }, all: { pro: {} } } } as any;
    expect(deriveStatus(info)).toBe('trialing');
  });

  test('INTRO periodType -> trialing', () => {
    const info = { entitlements: { active: { pro: { periodType: 'INTRO' } }, all: { pro: {} } } } as any;
    expect(deriveStatus(info)).toBe('trialing');
  });

  test('NORMAL active -> active', () => {
    const info = { entitlements: { active: { pro: { periodType: 'NORMAL' } }, all: { pro: {} } } } as any;
    expect(deriveStatus(info)).toBe('active');
  });

  test('in all but not active -> lapsed', () => {
    const info = { entitlements: { active: {}, all: { pro: {} } } } as any;
    expect(deriveStatus(info)).toBe('lapsed');
  });

  test('absent everywhere -> unknown', () => {
    const info = { entitlements: { active: {}, all: {} } } as any;
    expect(deriveStatus(info)).toBe('unknown');
  });
});
