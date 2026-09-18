export type ClientStatus = 'active' | 'suspended';
export type SubscriptionStatus = 'active' | 'suspended' | 'cancelled';
export type DeviceStatus = 'active' | 'revoked';
export type SessionMode = 'manual-login' | 'managed-first-party';
export type BrowserEngine = 'chrome-native' | 'nstchrome';
export type AuthStrategy = 'manual' | 'cookie-snapshot' | 'credential-autofill' | 'hybrid';
export type StorageStrategy = 'local-persistent' | 'cookies-only' | 'portable-first-party' | 'netflix-local-device';
export type NetworkStrategy = 'auto' | 'client-direct' | 'profile-proxy' | 'assigned-proxy';
export type ExtensionStrategy = 'guard-only' | 'main' | 'google' | 'custom';
export type ManagedSessionStatus = 'empty' | 'active' | 'needs_auth' | 'expired';
export type AdminRole = 'owner' | 'admin';
export type ProxyProtocol = 'unknown' | 'http' | 'https' | 'socks4' | 'socks5' | 'ssh';
export type ProxyValidationStatus = 'pending' | 'valid' | 'reachable' | 'invalid' | 'unverifiable';

export interface AdminSession {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: AdminRole;
}

export interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: AdminRole;
  enabled: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Plan {
  id: string;
  name: string;
  duration_days: number | null;
  max_profiles: number;
  profile_ids: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: ClientStatus;
  max_devices: number;
  allow_external_browsing: boolean;
  created_at: string;
  updated_at: string;
  credential?: {
    username: string;
    has_password: boolean;
  } | null;
  subscription?: Subscription | null;
}

export interface Subscription {
  id: string;
  client_id: string;
  plan_id: string;
  starts_at: string;
  expires_at: string;
  status: SubscriptionStatus;
  offline_grace_minutes: number;
  created_at: string;
  updated_at: string;
  plan?: Plan | null;
}

export interface Profile {
  id: string;
  name: string;
  url: string;
  platform: string | null;
  image_url: string | null;
  tags: string[];
  enabled: boolean;
  session_mode: SessionMode;
  session_ready: boolean;
  browser_engine: BrowserEngine;
  auth_strategy: AuthStrategy;
  storage_strategy: StorageStrategy;
  network_strategy: NetworkStrategy;
  extension_strategy: ExtensionStrategy;
  created_at: string;
  updated_at: string;
}

export interface ProfileProxyDefault {
  profile_id: string;
  proxy_id: string;
  updated_at: string;
}

export interface ProfileSessionState {
  profile_id: string;
  has_credentials: boolean;
  login_username: string | null;
  status: ManagedSessionStatus;
  version: number;
  public_ip: string | null;
  captured_at: string | null;
  validated_at: string | null;
  updated_at: string | null;
}

export interface ProxyRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string | null;
  enabled: boolean;
  has_password: boolean;
  proxy_type: ProxyProtocol;
  validation_status: ProxyValidationStatus;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_latency_ms: number | null;
  public_ip: string | null;
  country_code: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  validation_error: string | null;
  browser_compatible: boolean;
  created_at: string;
  updated_at: string;
}

export interface Assignment {
  id: string;
  client_id: string;
  profile_id: string;
  proxy_id: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  client?: Pick<Client, 'id' | 'name' | 'email'>;
  profile?: Pick<Profile, 'id' | 'name' | 'url'>;
  proxy?: Pick<ProxyRecord, 'id' | 'name' | 'host' | 'port'> | null;
}

export interface Device {
  id: string;
  client_id: string;
  name: string;
  os: string | null;
  status: DeviceStatus;
  last_ip: string | null;
  last_seen_at: string | null;
  created_at: string;
  client?: Pick<Client, 'id' | 'name' | 'email'>;
}

export interface ProfileUsage {
  id: string;
  client_id: string | null;
  device_id: string | null;
  profile_id: string | null;
  client_name: string;
  client_email: string | null;
  device_name: string | null;
  device_os: string | null;
  profile_name: string;
  profile_url: string | null;
  client_version: string | null;
  ip: string | null;
  opened_at: string;
  closed_at: string | null;
  close_reason: string | null;
}

export interface AuditLog {
  id: string;
  actor_type: 'admin' | 'client' | 'system';
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  ip_hash: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface DashboardStats {
  clients: number;
  activeClients: number;
  plans: number;
  profiles: number;
  proxies: number;
  devices: number;
  activeDevices: number;
  assignments: number;
}

export interface HealthInfo {
  ok: boolean;
  service: string;
  version: string;
  supabaseConfigured: boolean;
  proxyEncryptionConfigured: boolean;
  timestamp: string;
}

export type ViewKey =
  | 'dashboard'
  | 'clients'
  | 'plans'
  | 'profiles'
  | 'proxies'
  | 'assignments'
  | 'devices'
  | 'activity'
  | 'administrators'
  | 'system';
