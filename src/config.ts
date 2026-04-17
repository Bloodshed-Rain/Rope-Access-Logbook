import Constants from 'expo-constants';

interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

function requireEnv(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required config: ${name}. Check app.config.ts and .env.`);
  }
  return value;
}

export function getConfig(): AppConfig {
  const extra = Constants.expoConfig?.extra ?? {};
  return {
    supabaseUrl: requireEnv('supabaseUrl', extra.supabaseUrl),
    supabaseAnonKey: requireEnv('supabaseAnonKey', extra.supabaseAnonKey),
  };
}
