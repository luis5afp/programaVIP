import { Env } from './core';

export async function requestKeeperChecks(
  _env: Env,
  _profileIds: string[],
  _reason: 'admin-start' | 'client-start' | 'profile-update' | 'credentials-update',
): Promise<number> {
  // Session Manager performs low-frequency round-robin Keeper checks locally.
  // No external realtime/broadcast provider is required.
  return 0;
}

export async function requestAllKeeperChecks(
  _env: Env,
  _reason: 'admin-start',
): Promise<number> {
  return 0;
}
