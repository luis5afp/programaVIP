export interface Profile {
  id: string;
  name: string;
  url: string;
  username: string;
  credentialOk: boolean;
  lastCheck: string | null;
  image?: string;
}

export interface ModuleItem {
  id: string;
  name: string;
  icon: string;
  desc: string;
  category?: 'courses' | 'ai' | 'web';
  enabled: boolean;
  profiles: Profile[];
}

export interface ClientDevice {
  id: string;
  name: string;
  os: string;
  status: 'active' | 'revoked';
  last: string;
}

export interface ClientHistory {
  at: string;
  action: string;
}

export interface ClientSubscription {
  plan: string;
  start: string;
  end: string;
  renewal: 'manual' | 'automatic';
}

export interface Client {
  id: string;
  name: string;
  email: string;
  password?: string;
  phone: string;
  status: 'active' | 'suspended';
  subscription: ClientSubscription;
  modules: Record<string, boolean>;
  profileIds: string[];
  devices: ClientDevice[];
  history: ClientHistory[];
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  username: string;
  role: string;
  status: 'active' | 'inactive';
  last: string;
}

export interface RolePermission {
  name: string;
  permissions: string[];
}

export interface CourseHubData {
  modules: ModuleItem[];
  clients: Client[];
  admins: AdminUser[];
  roles: RolePermission[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  category: 'auth' | 'client' | 'module' | 'system' | 'security';
  ip?: string;
  details?: string;
}

export interface SecurityStats {
  totalClients: number;
  activeClients: number;
  totalDevices: number;
  revokedDevices: number;
  validCredentials: number;
  invalidCredentials: number;
  activeAdmins: number;
  mfaEnforced: boolean;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
  timestamp?: string;
}

export interface ServerHealthInfo {
  status: 'online' | 'offline' | 'error';
  service?: string;
  version?: string;
  latencyMs?: number;
  edgeRuntime?: string;
  error?: string;
  timestamp?: string;
}

export interface ValidationCode {
  code: string;
  clientId: string;
  clientName?: string;
  moduleId: string;
  moduleName?: string;
  profileId: string;
  profileName?: string;
  expiresAt: string;
  used: boolean;
  usedAt?: string;
  hwid?: string;
  createdAt: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
}

export interface ClientAppSession {
  clientId: string;
  moduleId: string;
  profileId: string;
  sessionPartition: string;
  cookiesSaved: boolean;
  validatedAt: string;
  lastAccessed: string;
}

export type ViewType = 'dashboard' | 'clients' | 'modules' | 'desktop-app' | 'admins' | 'roles' | 'security' | 'system';
export type ClientTabType = 'info' | 'subscription' | 'modules' | 'profiles' | 'devices' | 'history';
export type ReviewFilterType = 'all' | 'valid' | 'invalid';


