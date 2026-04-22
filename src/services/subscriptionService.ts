import { Platform } from 'react-native';
import Purchases, { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import Constants from 'expo-constants';
import { DbClient } from '../db/client';

export type SubscriptionTier = 'free' | 'pro';

export const ENTITLEMENT_ID = 'pro';

export interface SubscriptionService {
  init(): void;
  getTier(): Promise<SubscriptionTier>;
  getPackages(): Promise<PurchasesPackage[]>;
  purchase(pkg: PurchasesPackage): Promise<SubscriptionTier>;
  restore(): Promise<SubscriptionTier>;
}

export function createSubscriptionService(db: DbClient): SubscriptionService {
  async function syncTierToDb(info: CustomerInfo): Promise<SubscriptionTier> {
    const isPro = typeof info.entitlements.active[ENTITLEMENT_ID] !== 'undefined';
    const tier: SubscriptionTier = isPro ? 'pro' : 'free';
    
    // Attempt local database sync. This allows offline capability querying from the profile
    try {
      await db.run("UPDATE profile SET subscription_tier = ? WHERE 1=1", [tier]);
    } catch (e) {
      console.warn("Failed to sync tier to local DB", e);
    }
    
    return tier;
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

    async getTier() {
      try {
        const customerInfo = await Purchases.getCustomerInfo();
        return await syncTierToDb(customerInfo);
      } catch (e) {
        console.error("Failed to fetch Customer Info", e);
        // Fallback to local DB if offline
        const profile = await db.get<{ subscription_tier: SubscriptionTier }>('SELECT subscription_tier FROM profile LIMIT 1');
        return profile?.subscription_tier ?? 'free';
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
        console.error("Failed to get offerings", e);
        return [];
      }
    },

    async purchase(pkg: PurchasesPackage) {
      try {
        const { customerInfo } = await Purchases.purchasePackage(pkg);
        return await syncTierToDb(customerInfo);
      } catch (e: any) {
        if (!e.userCancelled) {
          console.error("Purchase failed", e);
          throw e;
        }
        return this.getTier(); // retain current tier
      }
    },

    async restore() {
      try {
        const customerInfo = await Purchases.restorePurchases();
        return await syncTierToDb(customerInfo);
      } catch (e) {
        console.error("Restore failed", e);
        throw e;
      }
    }
  };
}
