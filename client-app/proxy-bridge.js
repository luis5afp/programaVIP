import http from 'node:http';
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

function parseAuthority(value) {
  const authority = String(value || '').trim();
  if (!authority) throw new Error('Destino CONNECT vacío.');

  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    if (end < 0) throw new Error('Destino IPv6 inválido.');
    const host = authority.slice(1, end);
    const suffix = authority.slice(end + 1);
    const port = suffix.startsWith(':') ? Number(suffix.slice(1)) : 443;
    return { host, port: cleanPort(port) };
  }

  const separator = authority.lastIndexOf(':');
  if (separator <= 0) return { host: cleanHost(authority), port: 443 };
  return {
    host: cleanHost(authority.slice(0, separator)),
    port: cleanPort(authority.slice(separator + 1)),
  };
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

export async function startSocksHttpBridge(proxy) {
  const type = String(proxy?.type || '').toLowerCase();
  if (type !== 'socks4' && type !== 'socks5') throw new Error('El puente local requiere SOCKS4 o SOCKS5.');

  const sockets = new Set();
  const server = http.createServer((_request, response) => {
    response.writeHead(403, { Connection: 'close', 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('userFLOW proxy bridge accepts HTTPS CONNECT only.');
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  server.on('connect', (request, clientSocket, head) => {
    void (async () => {
      let upstream = null;
      try {
        const destination = parseAuthority(request.url);
        const result = await SocksClient.createConnection({
          proxy: socksOptions(proxy),
          command: 'connect',
          destination,
          timeout: 15_000,
        });
        upstream = result.socket;
        sockets.add(upstream);
        upstream.once('close', () => sockets.delete(upstream));

        clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: userFLOW\r\n\r\n');
        if (head?.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);

        const destroyPair = () => {
          if (!clientSocket.destroyed) clientSocket.destroy();
          if (upstream && !upstream.destroyed) upstream.destroy();
        };
        clientSocket.once('error', destroyPair);
        upstream.once('error', destroyPair);
      } catch {
        try {
          if (!clientSocket.destroyed) {
            clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
          }
        } catch {
          // Ignore a peer that already disconnected.
        }
        if (!clientSocket.destroyed) clientSocket.destroy();
        if (upstream && !upstream.destroyed) upstream.destroy();
      }
    })();
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
    proxyRules: `http://127.0.0.1:${address.port}`,
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
