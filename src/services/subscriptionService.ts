import { Platform } from 'react-native';
import Purchases, { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import Constants from 'expo-constants';
import { DbClient } from '../db/client';

export type SubscriptionStatus = 'unknown' | 'trialing' | 'active' | 'lapsed';

export const ENTITLEMENT_ID = 'pro';

export interface SubscriptionService {
  init(): void;
  getStatus(): Promise<SubscriptionStatus>;
  /** Trial info — only meaningful when status is 'trialing'. */
  getTrialDaysRemaining(): Promise<number | null>;
  /** Renewal date string (ISO) — only meaningful when status is 'active'. */
  getRenewalDate(): Promise<string | null>;
  getPackages(): Promise<PurchasesPackage[]>;
  purchase(pkg: PurchasesPackage): Promise<SubscriptionStatus>;
  restore(): Promise<SubscriptionStatus>;
}

const VALID_STATUSES = new Set<string>(['unknown', 'trialing', 'active', 'lapsed']);

export function deriveStatus(info: CustomerInfo): SubscriptionStatus {
  const activeEnt = info.entitlements.active[ENTITLEMENT_ID];
  if (activeEnt) {
    const period = activeEnt.periodType;
    return period === 'TRIAL' || period === 'INTRO' ? 'trialing' : 'active';
  }
  if (typeof info.entitlements.all[ENTITLEMENT_ID] !== 'undefined') {
    return 'lapsed';
  }
  return 'unknown';
}

export function createSubscriptionService(db: DbClient): SubscriptionService {
  async function syncStatusToDb(status: SubscriptionStatus): Promise<void> {
    try {
      await db.run('UPDATE profile SET subscription_status = ? WHERE 1=1', [status]);
    } catch (e) {
      console.warn('Failed to sync subscription status to local DB', e);
    }
  }

  // Full-semantics helper: live RC fetch → DB sync → offline fallback.
  // Used both as the public getStatus() body and inside purchase()'s
  // user-cancelled branch so no `this` reference is needed.
  async function resolveStatus(): Promise<SubscriptionStatus> {
    try {
      const info = await Purchases.getCustomerInfo();
      const status = deriveStatus(info);
      await syncStatusToDb(status);
      return status;
    } catch (e) {
      console.error('Failed to fetch CustomerInfo from RevenueCat', e);
      // Offline fallback: read persisted status from DB
      const profile = await db.get<{ subscription_status: string }>(
        'SELECT subscription_status FROM profile LIMIT 1',
      );
      const stored = profile?.subscription_status ?? 'unknown';
      // Coerce any legacy value (e.g. 'free', 'pro') that slipped through migration
      return VALID_STATUSES.has(stored) ? (stored as SubscriptionStatus) : 'unknown';
    }
  }

  return {
    init() {
      const appleKey = Constants.expoConfig?.extra?.revenueCatAppleKey;
      const googleKey = Constants.expoConfig?.extra?.revenueCatGoogleKey;

      if (Platform.OS === 'ios' && appleKey) {
        Purchases.configure({ apiKey: appleKey });
      } else if (Platform.OS === 'android' && googleKey) {
        Purchases.configure({ apiKey: googleKey });
      } else {
        console.warn('RevenueCat API Keys not configured for this platform.');
      }
    },

    async getStatus() {
      return resolveStatus();
    },

    async getTrialDaysRemaining() {
      try {
        const info = await Purchases.getCustomerInfo();
        const status = deriveStatus(info);
        if (status !== 'trialing') return null;
        const ent = info.entitlements.active[ENTITLEMENT_ID];
        if (!ent?.expirationDate) return null;
        const expMs = new Date(ent.expirationDate).getTime();
        const nowMs = Date.now();
        return Math.max(0, Math.floor((expMs - nowMs) / 86_400_000));
      } catch {
        return null;
      }
    },

    async getRenewalDate() {
      try {
        const info = await Purchases.getCustomerInfo();
        const status = deriveStatus(info);
        if (status !== 'active') return null;
        const ent = info.entitlements.active[ENTITLEMENT_ID];
        return ent?.expirationDate ?? null;
      } catch {
        return null;
      }
    },

    async getPackages() {
      try {
        const offerings = await Purchases.getOfferings();
        if (offerings.current !== null && offerings.current.availablePackages.length !== 0) {
          return offerings.current.availablePackages;
        }
        return [];
      } catch (e) {
        console.error('Failed to get offerings', e);
        return [];
      }
    },

    async purchase(pkg: PurchasesPackage) {
      try {
        const { customerInfo } = await Purchases.purchasePackage(pkg);
        const status = deriveStatus(customerInfo);
        await syncStatusToDb(status);
        return status;
      } catch (e: any) {
        if (!e.userCancelled) {
          console.error('Purchase failed', e);
          throw e;
        }
        return resolveStatus();
      }
    },

    async restore() {
      try {
        const customerInfo = await Purchases.restorePurchases();
        const status = deriveStatus(customerInfo);
        await syncStatusToDb(status);
        return status;
      } catch (e) {
        console.error('Restore failed', e);
        throw e;
      }
    },
  };
}
