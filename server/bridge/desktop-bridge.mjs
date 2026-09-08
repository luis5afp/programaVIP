import { randomBytes, createHash } from 'node:crypto';
import {BridgeError, cleanUrl, validateCookies} from './cookie-policy.mjs';
export {BridgeError, validateCookies};
const fail = (status, message) => { throw new BridgeError(status, message); };
const required = value => typeof value === 'string' && value.length > 0;
const expiry = value => value ? Date.parse(value) : NaN;
const digest = token => createHash('sha256').update(token).digest('hex');
// A profile is explicitly assigned, never inherited from a module or another client.
export function authorize(data, clientId, moduleId, profileId, now = Date.now()) {
  const client = data.clients?.find(c => c.id === clientId);
  if (!client || client.status !== 'active' || !Number.isFinite(expiry(client.subscription?.end)) || expiry(client.subscription.end) <= now) fail(403, 'Client access denied');
  if (!moduleId) return { client };
  const module = data.modules?.find(m => m.id === moduleId);
  if (!module || module.enabled !== true || client.modules?.[moduleId] !== true) fail(403, 'Module access denied');
  if (!profileId) return { client, module };
  if (!Array.isArray(client.profileIds) || !client.profileIds.includes(profileId)) fail(403, 'Profile access denied');
  const profile = module.profiles?.find(p => p.id === profileId);
  if (!profile || profile.credentialOk !== true) fail(403, 'Profile unavailable');
  cleanUrl(profile.url);
  return { client, module, profile };
}
export function publicCatalog(data, clientId, now = Date.now()) {
  const { client } = authorize(data, clientId, null, null, now);
  return {
    client: { id: client.id, name: client.name, plan: client.subscription.plan, expiresAt: client.subscription.end },
    modules: (data.modules || []).filter(m => m.enabled === true && client.modules?.[m.id] === true).map(m => ({
      id: m.id, name: m.name, icon: m.icon || '', category: m.category || 'web',
      profiles: (m.profiles || []).filter(p => client.profileIds?.includes(p.id) && p.credentialOk === true).map(p => ({
        id: p.id, name: p.name, url: cleanUrl(p.url).href,
      })),
    })).filter(m => m.profiles.length > 0),
  };
}
// All dependencies must be backed by a secure, durable implementation in production.
export function createDesktopBridge({ authenticate, sessions, readData, readBundle, now = Date.now, audit = () => {} }) {
  if (typeof authenticate !== 'function' || typeof readData !== 'function' || typeof readBundle !== 'function' || !sessions || ['put','get','revoke'].some(k => typeof sessions[k] !== 'function')) throw new Error('Secure bridge dependencies are required');
  const current = async (token, deviceId) => {
    if (!required(token) || !required(deviceId)) fail(401, 'Authentication required');
    const record = await sessions.get(digest(token));
    if (!record || record.deviceId !== deviceId || record.expiresAt <= now() || record.revoked) fail(401, 'Session expired or revoked');
    const data = await readData();
    const result = authorize(data, record.clientId, null, null, now());
    const device = result.client.devices?.find(d => d.id === deviceId);
    if (!device || device.status !== 'active') fail(403, 'Device access denied');
    return { ...record, data };
  };
  return {
    async login({ identifier, password, deviceId }) {
      if (!required(identifier) || !required(password) || !required(deviceId)) fail(400, 'Credentials and device required');
      const identity = await authenticate({ identifier, password, deviceId });
      if (!identity || !required(identity.clientId) || identity.deviceId !== deviceId) fail(401, 'Invalid credentials');
      const data = await readData();
      const {client} = authorize(data, identity.clientId, null, null, now());
      if (!client.devices?.some(d => d.id === deviceId && d.status === 'active')) fail(403, 'Device not approved');
      const token = randomBytes(32).toString('base64url');
      const expiresAt = Math.min(now() + 15 * 60_000, expiry(client.subscription.end));
      await sessions.put(digest(token), { clientId:client.id, deviceId, expiresAt, revoked:false });
      audit({action:'login',clientId:client.id,deviceId});
      return {token,expiresAt:new Date(expiresAt).toISOString(),client:{id:client.id,name:client.name}};
    },
    async catalog(token, deviceId) {
      const {clientId,data} = await current(token,deviceId);
      return publicCatalog(data,clientId,now());
    },
    async bundle(token, deviceId, moduleId, profileId) {
      const {clientId,data,expiresAt} = await current(token,deviceId);
      const {profile} = authorize(data,clientId,moduleId,profileId,now());
      // The vault must store explicitly approved, encrypted-at-rest sessions. Never use seed or auto-generated cookies.
      const bundle = await readBundle({clientId,moduleId,profileId});
      if (!bundle || bundle.approved !== true || bundle.source !== 'admin-verified' || bundle.profileId !== profileId || bundle.clientId !== clientId || bundle.moduleId !== moduleId || !Number.isFinite(expiry(bundle.expiresAt)) || expiry(bundle.expiresAt) <= now()) fail(403, 'No approved session available');
      if (cleanUrl(bundle.url).origin !== cleanUrl(profile.url).origin) fail(403, 'Session origin mismatch');
      const cookies = validateCookies(bundle.cookies, profile.url, now(), Array.isArray(profile.allowedCookieDomains) ? profile.allowedCookieDomains : []);
      audit({action:'session-delivered',clientId,deviceId,moduleId,profileId,count:cookies.length});
      return {moduleId,profileId,url:profile.url,version:bundle.version,expiresAt:new Date(Math.min(expiresAt,expiry(bundle.expiresAt))).toISOString(),cookies};
    },
    async heartbeat(token,deviceId) { const {clientId} = await current(token,deviceId); return {authorized:true,clientId}; },
    async logout(token,deviceId) { await current(token,deviceId); await sessions.revoke(digest(token)); return {success:true}; },
  };
}
