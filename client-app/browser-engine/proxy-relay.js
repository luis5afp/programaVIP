import net from 'node:net';
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


export async function probeKaizenProxyDestination(input, destination) {
  const proxy = normalizedProxy(input);
  const target = {
    host: cleanHost(destination?.host),
    port: cleanPort(destination?.port),
  };
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const tunnel = await connectUpstream(proxy, target);
      try { tunnel.socket.destroy(); } catch {}
      return { ok: true, destination: target, upstream: { type: proxy.type, host: proxy.host, port: proxy.port } };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 200 : 500));
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError || 'conexión rechazada');
  throw new Error(`El proxy no pudo conectar con ${target.host}:${target.port}: ${detail}`);
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
      const tunnel = await connectUpstream(proxy, request.destination);
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
