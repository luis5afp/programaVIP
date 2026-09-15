import net from 'node:net';
import { SocksClient } from 'socks';

function cleanHost(value) {
  const host = String(value || '').trim();
  if (!host || /[\s/@]/.test(host)) throw new Error('Host SOCKS inválido.');
  return host;
}

function cleanPort(value) {
  const port = Number(value || 0);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Puerto SOCKS inválido.');
  return port;
}

function socksOptions(proxy) {
  const type = String(proxy?.type || '').toLowerCase() === 'socks4' ? 4 : 5;
  const options = {
    host: cleanHost(proxy?.host),
    port: cleanPort(proxy?.port),
    type,
  };
  const username = typeof proxy?.username === 'string' ? proxy.username : '';
  const password = typeof proxy?.password === 'string' ? proxy.password : '';
  if (username) options.userId = username;
  if (type === 5 && password) options.password = password;
  return options;
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
  const version = buffer[0];
  const command = buffer[1];
  const addressType = buffer[3];
  if (version !== 0x05) throw Object.assign(new Error('Versión SOCKS local inválida.'), { replyCode: 0x01 });
  if (command !== 0x01) throw Object.assign(new Error('Solo se permite SOCKS CONNECT.'), { replyCode: 0x07 });

  let host;
  let cursor = 4;
  if (addressType === 0x01) {
    if (buffer.length < cursor + 4 + 2) return null;
    host = Array.from(buffer.subarray(cursor, cursor + 4)).join('.');
    cursor += 4;
  } else if (addressType === 0x03) {
    if (buffer.length < cursor + 1) return null;
    const length = buffer[cursor];
    cursor += 1;
    if (length < 1) throw Object.assign(new Error('Dominio SOCKS local vacío.'), { replyCode: 0x08 });
    if (buffer.length < cursor + length + 2) return null;
    host = buffer.subarray(cursor, cursor + length).toString('utf8');
    cursor += length;
  } else if (addressType === 0x04) {
    if (buffer.length < cursor + 16 + 2) return null;
    host = ipv6Text(buffer, cursor);
    cursor += 16;
  } else {
    throw Object.assign(new Error('Tipo de dirección SOCKS no compatible.'), { replyCode: 0x08 });
  }

  if (buffer.length < cursor + 2) return null;
  const port = buffer.readUInt16BE(cursor);
  cursor += 2;
  return {
    destination: { host: cleanHost(host), port: cleanPort(port) },
    consumed: cursor,
  };
}

function failureReply(code = 0x01) {
  return Buffer.from([0x05, code, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

const SUCCESS_REPLY = Buffer.from([0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

function serveLocalSocks5(clientSocket, proxy, sockets) {
  let stage = 'greeting';
  let buffered = Buffer.alloc(0);
  let upstream = null;
  let finished = false;

  const destroyPair = () => {
    if (finished) return;
    finished = true;
    if (!clientSocket.destroyed) clientSocket.destroy();
    if (upstream && !upstream.destroyed) upstream.destroy();
  };

  const fail = (replyCode = 0x01, greetingFailure = false) => {
    if (finished) return;
    try {
      if (!clientSocket.destroyed) {
        clientSocket.write(greetingFailure ? Buffer.from([0x05, 0xff]) : failureReply(replyCode));
      }
    } catch {
      // Ignore a peer that already disconnected.
    }
    destroyPair();
  };

  const connectUpstream = async (request) => {
    stage = 'connecting';
    clientSocket.pause();
    clientSocket.removeListener('data', onData);
    const pending = buffered.subarray(request.consumed);
    buffered = Buffer.alloc(0);

    try {
      const result = await SocksClient.createConnection({
        proxy: socksOptions(proxy),
        command: 'connect',
        destination: request.destination,
        timeout: 15_000,
      });
      if (finished || clientSocket.destroyed) {
        result.socket.destroy();
        return;
      }

      upstream = result.socket;
      sockets.add(upstream);
      upstream.once('close', () => sockets.delete(upstream));
      upstream.once('error', destroyPair);

      clientSocket.write(SUCCESS_REPLY);
      if (pending.length) upstream.write(pending);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
      stage = 'relay';
      clientSocket.resume();
    } catch (error) {
      fail(Number(error?.replyCode || 0x01));
    }
  };

  const onData = (chunk) => {
    if (finished || stage === 'relay' || stage === 'connecting') return;
    buffered = buffered.length ? Buffer.concat([buffered, chunk]) : Buffer.from(chunk);

    if (stage === 'greeting') {
      if (buffered.length < 2) return;
      if (buffered[0] !== 0x05) {
        fail(0x01, true);
        return;
      }
      const methodCount = buffered[1];
      const greetingLength = 2 + methodCount;
      if (buffered.length < greetingLength) return;
      const methods = buffered.subarray(2, greetingLength);
      if (!methods.includes(0x00)) {
        fail(0x01, true);
        return;
      }
      clientSocket.write(Buffer.from([0x05, 0x00]));
      buffered = buffered.subarray(greetingLength);
      stage = 'request';
    }

    if (stage === 'request') {
      try {
        const request = parseSocks5Request(buffered);
        if (!request) return;
        void connectUpstream(request);
      } catch (error) {
        fail(Number(error?.replyCode || 0x01));
      }
    }
  };

  clientSocket.once('error', destroyPair);
  clientSocket.on('data', onData);
  clientSocket.once('end', destroyPair);
  clientSocket.once('close', () => {
    sockets.delete(clientSocket);
    if (!finished) {
      finished = true;
      if (upstream && !upstream.destroyed) upstream.destroy();
    }
  });
}

export async function startSocksHttpBridge(proxy) {
  const type = String(proxy?.type || '').toLowerCase();
  if (type !== 'socks4' && type !== 'socks5') throw new Error('El puente local requiere SOCKS4 o SOCKS5.');

  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    serveLocalSocks5(socket, proxy, sockets);
  });

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
    throw new Error('No se pudo iniciar el puente SOCKS local.');
  }

  let closed = false;
  return {
    proxyRules: `socks5://127.0.0.1:${address.port}`,
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) {
        try { socket.destroy(); } catch {}
      }
      await new Promise((resolve) => {
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      });
    },
  };
}
