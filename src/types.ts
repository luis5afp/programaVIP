export type ClientStatus = 'active' | 'suspended';
export type SubscriptionStatus = 'active' | 'suspended' | 'cancelled';
export type DeviceStatus = 'active' | 'revoked';
export type SessionMode = 'manual-login' | 'managed-first-party';

export interface AdminSession {
  username: string;
}

export interface Plan {
  id: string;
  name: string;
  duration_days: number | null;
  max_devices: number;
  max_profiles: number;
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
  created_at: string;
  updated_at: string;
}

export interface ProfileProxyDefault {
  profile_id: string;
  proxy_id: string;
  updated_at: string;
}

export interface ProxyRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string | null;
  enabled: boolean;
  has_password: boolean;
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
  last_seen_at: string | null;
  created_at: string;
  client?: Pick<Client, 'id' | 'name' | 'email'>;
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
  | 'audit'
  | 'system';
