// __tests__/services/subscriptionService.test.ts
import { createTestClient } from '../setup';
import { createSubscriptionService, SubscriptionStatus } from '../../src/services/subscriptionService';
import { DbClient } from '../../src/db/client';

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    getCustomerInfo: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
    getOfferings: jest.fn(),
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
});
