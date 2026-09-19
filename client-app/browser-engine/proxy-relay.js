import net from 'node:net';
import dns from 'node:dns/promises';
import tls from 'node:tls';
import { SocksClient } from 'socks';

function cleanHost(value) {
  const host = String(value || '').trim();
  if (!host || /[\s/@]/.test(host)) throw new Error('Host de proxy inválido.');
  return host;
}

function cleanPort(value) {
  const port = Number(value || 0);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Puerto de proxy inválido.');
  return port;
}

function isGoogleAccountsHost(value) {
  const host = String(value || '').trim().toLowerCase();
  return host === 'accounts.google.com'
    || /^accounts\.google\.(?:[a-z]{2}|(?:com|co)\.[a-z]{2})$/i.test(host);
}

function proxyType(proxy) {
  const type = String(proxy?.type || 'http').trim().toLowerCase();
  if (type === 'https') return 'http';
  if (type === 'socks') return 'socks5';
  if (!['http', 'socks4', 'socks5'].includes(type)) {
    throw new Error(`Tipo de proxy no compatible: ${type || 'vacío'}.`);
  }
  return type;
}

function normalizedProxy(proxy) {
  return {
    type: proxyType(proxy),
    host: cleanHost(proxy?.host),
    port: cleanPort(proxy?.port),
    username: typeof proxy?.username === 'string' ? proxy.username : '',
    password: typeof proxy?.password === 'string' ? proxy.password : '',
  };
}

function ipv6Text(buffer, offset) {
  const groups = [];
  for (let index = 0; index < 16; index += 2) {
    groups.push(buffer.readUInt16BE(offset + index).toString(16));
  }
  return groups.join(':');
}

function parseSocks5Request(buffer) {
  if (buffer.length < 4) return null;
  if (buffer[0] !== 0x05) throw Object.assign(new Error('Versión SOCKS local inválida.'), { replyCode: 0x01 });
  if (buffer[1] !== 0x01) throw Object.assign(new Error('Solo se permite SOCKS CONNECT.'), { replyCode: 0x07 });

  let host;
  let cursor = 4;
  const addressType = buffer[3];
  if (addressType === 0x01) {
    if (buffer.length < cursor + 6) return null;
    host = Array.from(buffer.subarray(cursor, cursor + 4)).join('.');
    cursor += 4;
  } else if (addressType === 0x03) {
    if (buffer.length < cursor + 1) return null;
    const length = buffer[cursor];
    cursor += 1;
    if (!length) throw Object.assign(new Error('Dominio SOCKS local vacío.'), { replyCode: 0x08 });
    if (buffer.length < cursor + length + 2) return null;
    host = buffer.subarray(cursor, cursor + length).toString('utf8');
    cursor += length;
  } else if (addressType === 0x04) {
    if (buffer.length < cursor + 18) return null;
    host = ipv6Text(buffer, cursor);
    cursor += 16;
  } else {
    throw Object.assign(new Error('Tipo de dirección SOCKS no compatible.'), { replyCode: 0x08 });
  }

  if (buffer.length < cursor + 2) return null;
  const port = buffer.readUInt16BE(cursor);
  cursor += 2;
  return { destination: { host: cleanHost(host), port: cleanPort(port) }, consumed: cursor };
}

const SOCKS_SUCCESS = Buffer.from([0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
function socksFailure(code = 0x01) {
  return Buffer.from([0x05, code, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

function httpConnect(proxy, destination) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxy.port, proxy.host);
    let settled = false;
    let head = Buffer.alloc(0);

    const fail = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(20_000, () => fail(new Error('El proxy HTTP agotó el tiempo de conexión.')));
    socket.once('error', fail);
    socket.once('connect', () => {
      const authority = `${destination.host}:${destination.port}`;
      const lines = [
        `CONNECT ${authority} HTTP/1.1`,
        `Host: ${authority}`,
        'Proxy-Connection: keep-alive',
      ];
      if (proxy.username || proxy.password) {
        const encoded = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
        lines.push(`Proxy-Authorization: Basic ${encoded}`);
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });

    const onData = (chunk) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) {
        if (head.length > 65_536) fail(new Error('Respuesta CONNECT demasiado grande.'));
        return;
      }

      socket.removeListener('data', onData);
      const statusLine = head.subarray(0, head.indexOf('\r\n')).toString('latin1').trim();
      const status = Number(statusLine.split(' ')[1]);
      if (status !== 200) {
        fail(new Error(status === 407
          ? 'El proxy HTTP rechazó las credenciales (407).'
          : `El proxy HTTP rechazó CONNECT (${statusLine}).`));
        return;
      }

      settled = true;
      socket.setTimeout(0);
      resolve({ socket, leftover: head.subarray(end + 4) });
    };
    socket.on('data', onData);
  });
}

async function connectUpstream(proxy, destination) {
  if (proxy.type === 'http') return httpConnect(proxy, destination);

  const options = {
    proxy: {
      host: proxy.host,
      port: proxy.port,
      type: proxy.type === 'socks4' ? 4 : 5,
    },
    command: 'connect',
    destination,
    timeout: 20_000,
  };
  if (proxy.username) options.proxy.userId = proxy.username;
  if (proxy.type !== 'socks4' && proxy.password) options.proxy.password = proxy.password;
  const result = await SocksClient.createConnection(options);
  return { socket: result.socket, leftover: null };
}

async function connectUpstreamWithRetry(proxy, destination, attempts = 3) {
  let lastError = null;
  const total = Math.max(1, Number(attempts) || 1);
  for (let attempt = 0; attempt < total; attempt += 1) {
    try {
      return await connectUpstream(proxy, destination);
    } catch (error) {
      lastError = error;
      if (attempt < total - 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 180 : 450));
      }
    }
  }

  const host = String(destination?.host || '').trim();
  const shouldResolveLocally = proxy.type === 'socks5'
    && isGoogleAccountsHost(host)
    && net.isIP(host) === 0;

  if (shouldResolveLocally) {
    try {
      const resolved = await dns.lookup(host, { all: true, verbatim: true });
      const unique = [];
      for (const item of resolved) {
        const address = String(item?.address || '').trim();
        if (!address || unique.includes(address)) continue;
        unique.push(address);
      }
      unique.sort((a, b) => Number(net.isIPv6?.(a) || 0) - Number(net.isIPv6?.(b) || 0));

      for (const address of unique.slice(0, 6)) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            return await connectUpstream(proxy, { ...destination, host: address });
          } catch (error) {
            lastError = error;
            if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      }
    } catch (error) {
      lastError = lastError || error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'conexión rechazada'));
}

async function httpsProbe(proxy, { host, path = '/', port = 443, method = 'HEAD' }) {
  const target = { host: cleanHost(host), port: cleanPort(port) };
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let tunnel = null;
    try {
      tunnel = await connectUpstreamWithRetry(proxy, target, 2);
      const result = await new Promise((resolve, reject) => {
        let settled = false;
        let response = Buffer.alloc(0);
        const socket = tls.connect({
          socket: tunnel.socket,
          servername: target.host,
          rejectUnauthorized: true,
        });

        const fail = (error) => {
          if (settled) return;
          settled = true;
          try { socket.destroy(); } catch {}
          reject(error);
        };

        socket.setTimeout(20_000, () => fail(new Error('El destino HTTPS agotó el tiempo de respuesta.')));
        socket.once('error', fail);
        socket.once('secureConnect', () => {
          socket.write(
            `${method} ${path} HTTP/1.1\r\nHost: ${target.host}\r\nUser-Agent: userFLEX-proxy-check/0.3.14\r\nAccept: */*\r\nConnection: close\r\n\r\n`,
          );
        });
        socket.on('data', (chunk) => {
          response = Buffer.concat([response, chunk]);
          if (response.length > 512_000) return fail(new Error('La respuesta HTTPS del destino fue demasiado grande.'));
        });
        socket.once('end', () => {
          if (settled) return;
          settled = true;
          const text = response.toString('utf8');
          const firstLine = text.split('\r\n', 1)[0] || '';
          const status = Number(firstLine.split(' ')[1] || 0);
          if (!status) return reject(new Error('El destino HTTPS no devolvió una respuesta HTTP válida.'));
          resolve({ status, raw: text });
        });
      });
      return { ok: true, ...result, destination: target };
    } catch (error) {
      lastError = error;
      try { tunnel?.socket?.destroy(); } catch {}
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 250 : 650));
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError || 'conexión HTTPS rechazada');
  throw new Error(`El proxy no pudo completar HTTPS con ${target.host}:${target.port}: ${detail}`);
}

export async function probeKaizenProxyDestination(input, destination) {
  const proxy = normalizedProxy(input);
  const target = {
    host: cleanHost(destination?.host),
    port: cleanPort(destination?.port),
  };
  try {
    const tunnel = await connectUpstreamWithRetry(proxy, target, 3);
    try { tunnel.socket.destroy(); } catch {}
    return { ok: true, destination: target, upstream: { type: proxy.type, host: proxy.host, port: proxy.port } };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || 'conexión rechazada');
    throw new Error(`El proxy no pudo conectar con ${target.host}:${target.port}: ${detail}`);
  }
}

export async function probeKaizenProxyHttps(input, target) {
  const proxy = normalizedProxy(input);
  const result = await httpsProbe(proxy, target);
  return {
    ok: true,
    status: result.status,
    destination: result.destination,
    upstream: { type: proxy.type, host: proxy.host, port: proxy.port },
  };
}

export async function kaizenProxyPublicIp(input) {
  const proxy = normalizedProxy(input);
  const result = await httpsProbe(proxy, {
    host: 'api.ipify.org',
    port: 443,
    path: '/?format=json',
    method: 'GET',
  });
  const match = result.raw.match(/"ip"\s*:\s*"([^"]+)"/i);
  return match?.[1]?.trim() || null;
}

function serveClient(clientSocket, proxy, sockets) {
  sockets.add(clientSocket);
  let stage = 'greeting';
  let buffered = Buffer.alloc(0);
  let upstream = null;
  let done = false;

  const destroyPair = () => {
    if (done) return;
    done = true;
    try { clientSocket.destroy(); } catch {}
    try { upstream?.destroy(); } catch {}
  };

  const fail = (code = 0x01, greeting = false) => {
    if (done) return;
    try { clientSocket.write(greeting ? Buffer.from([0x05, 0xff]) : socksFailure(code)); } catch {}
    destroyPair();
  };

  const connect = async (request) => {
    stage = 'connecting';
    clientSocket.pause();
    clientSocket.removeListener('data', onData);
    const pending = buffered.subarray(request.consumed);
    buffered = Buffer.alloc(0);

    try {
      const attempts = isGoogleAccountsHost(request.destination.host) ? 7 : 3;
      const tunnel = await connectUpstreamWithRetry(proxy, request.destination, attempts);
      if (done || clientSocket.destroyed) {
        tunnel.socket.destroy();
        return;
      }
      upstream = tunnel.socket;
      sockets.add(upstream);
      upstream.once('close', () => sockets.delete(upstream));
      upstream.once('error', destroyPair);

      clientSocket.write(SOCKS_SUCCESS);
      if (tunnel.leftover?.length) clientSocket.write(tunnel.leftover);
      if (pending.length) upstream.write(pending);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
      stage = 'relay';
      clientSocket.resume();
    } catch {
      fail(0x01);
    }
  };

  const onData = (chunk) => {
    if (done || stage === 'relay' || stage === 'connecting') return;
    buffered = buffered.length ? Buffer.concat([buffered, chunk]) : Buffer.from(chunk);

    if (stage === 'greeting') {
      if (buffered.length < 2) return;
      if (buffered[0] !== 0x05) return fail(0x01, true);
      const methodCount = buffered[1];
      const greetingLength = 2 + methodCount;
      if (buffered.length < greetingLength) return;
      if (!buffered.subarray(2, greetingLength).includes(0x00)) return fail(0x01, true);
      clientSocket.write(Buffer.from([0x05, 0x00]));
      buffered = buffered.subarray(greetingLength);
      stage = 'request';
    }

    if (stage === 'request') {
      try {
        const request = parseSocks5Request(buffered);
        if (request) void connect(request);
      } catch (error) {
        fail(Number(error?.replyCode || 0x01));
      }
    }
  };

  clientSocket.on('data', onData);
  clientSocket.once('error', destroyPair);
  clientSocket.once('close', () => {
    sockets.delete(clientSocket);
    if (!done) {
      done = true;
      try { upstream?.destroy(); } catch {}
    }
  });
}

export async function startKaizenProxyRelay(input) {
  const proxy = normalizedProxy(input);
  const sockets = new Set();
  const server = net.createServer((socket) => serveClient(socket, proxy, sockets));

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('No se pudo iniciar el relay local del perfil.');
  }

  let closed = false;
  return {
    port: address.port,
    proxyRules: `socks5://127.0.0.1:${address.port}`,
    upstream: { type: proxy.type, host: proxy.host, port: proxy.port },
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) {
        try { socket.destroy(); } catch {}
      }
      await new Promise((resolve) => {
        try { server.close(() => resolve()); } catch { resolve(); }
      });
    },
  };
}
