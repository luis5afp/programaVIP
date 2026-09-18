import { BridgeError } from './desktop-bridge.mjs';
// Mount before the legacy API and its broad CORS/body-parser middleware.
// No browser origin is accepted: this is a native-client API, not an admin API.
export function createBridgeHttpHandler(bridge) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (status, data) => res.status(status).json(data);
    try {
      if (req.headers.origin) throw new BridgeError(403, 'Browser origins are not accepted');
      if (Number(req.headers['content-length'] || 0) > 65536 || JSON.stringify(req.body || {}).length > 65536) throw new BridgeError(413, 'Request too large');
      const method = req.method.toUpperCase(), route = req.path;
      const body = req.body || {};
      if (method === 'GET' && route === '/health') return send(200, {status:'ok',protocol:'userflex-bridge-v1'});
      if (method === 'POST' && !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new BridgeError(415, 'JSON required');
      if (method === 'POST' && route === '/login') return send(200, await bridge.login(body));
      const auth = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(String(req.headers.authorization || ''));
      if (!auth) throw new BridgeError(401, 'Authentication required');
      const token = auth[1], deviceId = req.headers['x-device-id'];
      if (method === 'GET' && route === '/catalog') return send(200, await bridge.catalog(token,deviceId));
      if (method === 'POST' && route === '/session') return send(200, await bridge.bundle(token,deviceId,body.moduleId,body.profileId));
      if (method === 'POST' && route === '/heartbeat') return send(200, await bridge.heartbeat(token,deviceId));
      if (method === 'POST' && route === '/logout') return send(200, await bridge.logout(token,deviceId));
      return send(404, {error:'Not found'});
    } catch (error) {
      return send(error instanceof BridgeError ? error.status : 500, {error:error instanceof BridgeError ? error.message : 'Internal server error'});
    }
  };
}
