import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { SocksClient } from 'socks';
import { startSocksHttpBridge } from './proxy-bridge.js';

function listen(server) {
  return new Promise((resolve, reject) => {
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
}

function close(server) {
  return new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function serverPort(server) {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

function fakeSocks5Server(targetPort) {
  return net.createServer((socket) => {
    let stage = 'greeting';
    let buffered = Buffer.alloc(0);

    const fail = (error) => {
      socket.destroy(error instanceof Error ? error : new Error(String(error)));
    };

    const onData = (chunk) => {
      buffered = buffered.length ? Buffer.concat([buffered, chunk]) : Buffer.from(chunk);
      try {
        if (stage === 'greeting') {
          if (buffered.length < 2) return;
          assert.equal(buffered[0], 0x05);
          const count = buffered[1];
          const total = 2 + count;
          if (buffered.length < total) return;
          assert.ok(buffered.subarray(2, total).includes(0x00));
          socket.write(Buffer.from([0x05, 0x00]));
          buffered = buffered.subarray(total);
          stage = 'request';
        }

        if (stage === 'request') {
          if (buffered.length < 10) return;
          assert.equal(buffered[0], 0x05);
          assert.equal(buffered[1], 0x01);
          assert.equal(buffered[3], 0x01);
          const requestedPort = buffered.readUInt16BE(8);
          assert.equal(requestedPort, targetPort);
          const pending = buffered.subarray(10);
          buffered = Buffer.alloc(0);
          stage = 'relay';
          socket.removeListener('data', onData);

          const targetSocket = net.createConnection({ host: '127.0.0.1', port: targetPort }, () => {
            socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0x7f, 0x00, 0x00, 0x01, 0x00, 0x00]));
            if (pending.length) targetSocket.write(pending);
            socket.pipe(targetSocket);
            targetSocket.pipe(socket);
          });
          targetSocket.once('error', fail);
        }
      } catch (error) {
        fail(error);
      }
    };

    socket.on('data', onData);
  });
}

test('transparent SOCKS relay carries a complete HTTP response through an upstream SOCKS5 proxy', async (t) => {
  const target = http.createServer((request, response) => {
    assert.equal(request.url, '/probe');
    response.writeHead(200, { 'content-type': 'text/plain', connection: 'close' });
    response.end('relay-ok');
  });
  await listen(target);
  t.after(() => close(target));
  const targetPort = serverPort(target);

  const upstreamProxy = fakeSocks5Server(targetPort);
  await listen(upstreamProxy);
  t.after(() => close(upstreamProxy));

  const bridge = await startSocksHttpBridge({
    type: 'socks5',
    host: '127.0.0.1',
    port: serverPort(upstreamProxy),
  });
  t.after(() => bridge.close());

  const localProxyUrl = new URL(bridge.proxyRules);
  assert.equal(localProxyUrl.protocol, 'socks5:');
  assert.equal(localProxyUrl.hostname, '127.0.0.1');

  const connected = await SocksClient.createConnection({
    proxy: {
      host: localProxyUrl.hostname,
      port: Number(localProxyUrl.port),
      type: 5,
    },
    command: 'connect',
    destination: { host: '127.0.0.1', port: targetPort },
    timeout: 5_000,
  });
  const socket = connected.socket;
  t.after(() => socket.destroy());

  let rawResponse = '';
  const responseFinished = new Promise((resolve, reject) => {
    socket.setTimeout(5_000, () => reject(new Error('Timed out waiting for relayed HTTP response.')));
    socket.on('data', (chunk) => { rawResponse += chunk.toString('utf8'); });
    socket.once('end', resolve);
    socket.once('error', reject);
  });

  socket.end('GET /probe HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
  await responseFinished;

  assert.match(rawResponse, /HTTP\/1\.1 200 OK/);
  assert.match(rawResponse, /relay-ok/);
});
