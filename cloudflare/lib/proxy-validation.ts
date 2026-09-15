import { connect, type Socket } from 'cloudflare:sockets';

export type ProxyProtocol = 'unknown' | 'http' | 'https' | 'socks4' | 'socks5' | 'ssh';
export type ProxyValidationStatus = 'pending' | 'valid' | 'reachable' | 'invalid' | 'unverifiable';

export interface ProxyValidationInput {
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}

export interface ProxyValidationResult {
  proxyType: ProxyProtocol;
  status: ProxyValidationStatus;
  checkedAt: string;
  latencyMs: number | null;
  publicIp: string | null;
  countryCode: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  error: string | null;
  browserCompatible: boolean;
}

type ProbeResult = {
  detected: boolean;
  proxyType: Exclude<ProxyProtocol, 'unknown'>;
  status: 'valid' | 'reachable' | 'invalid';
  publicIp: string | null;
  latencyMs: number | null;
  error: string | null;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PROBE_HOST = 'api.ipify.org';
const PROBE_PORT = 80;
const PROBE_TIMEOUT_MS = 5_500;
const HTTP_TIMEOUT_MS = 7_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

function cleanError(error: unknown, fallback = 'No se pudo completar la comprobación.') {
  const raw = error instanceof Error ? error.message : String(error || fallback);
  return raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240) || fallback;
}

function timeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, wait]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
}

class SocketReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffer = new Uint8Array(0);

  constructor(readable: ReadableStream<Uint8Array>) {
    this.reader = readable.getReader();
  }

  async exact(count: number, milliseconds = PROBE_TIMEOUT_MS): Promise<Uint8Array> {
    while (this.buffer.length < count) {
      const result = await timeout(this.reader.read(), milliseconds, 'Tiempo de espera agotado leyendo el proxy.');
      if (result.done || !result.value) throw new Error('El proxy cerró la conexión antes de responder.');
      this.buffer = concatBytes(this.buffer, result.value);
      if (this.buffer.length > MAX_RESPONSE_BYTES) throw new Error('La respuesta del proxy es demasiado grande.');
    }
    const value = this.buffer.slice(0, count);
    this.buffer = this.buffer.slice(count);
    return value;
  }

  async textUntilClose(maxBytes = MAX_RESPONSE_BYTES, milliseconds = HTTP_TIMEOUT_MS): Promise<string> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (this.buffer.length) {
      chunks.push(this.buffer);
      total += this.buffer.length;
      this.buffer = new Uint8Array(0);
    }

    const deadline = Date.now() + milliseconds;
    while (total < maxBytes) {
      const remaining = Math.max(1, deadline - Date.now());
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await timeout(this.reader.read(), remaining, 'Tiempo de espera agotado esperando la respuesta del proxy.');
      } catch (error) {
        if (total > 0) break;
        throw error;
      }
      if (result.done || !result.value) break;
      chunks.push(result.value);
      total += result.value.length;
    }

    const merged = new Uint8Array(Math.min(total, maxBytes));
    let offset = 0;
    for (const chunk of chunks) {
      if (offset >= merged.length) break;
      const available = Math.min(chunk.length, merged.length - offset);
      merged.set(chunk.subarray(0, available), offset);
      offset += available;
    }
    return decoder.decode(merged);
  }

  release() {
    try { this.reader.releaseLock(); } catch { /* already released */ }
  }
}

async function write(socket: Socket, value: Uint8Array | string) {
  const writer = socket.writable.getWriter();
  try {
    await timeout(writer.write(typeof value === 'string' ? encoder.encode(value) : value), PROBE_TIMEOUT_MS, 'Tiempo de espera agotado enviando datos al proxy.');
  } finally {
    try { writer.releaseLock(); } catch { /* already released */ }
  }
}

function closeSocket(socket: Socket | null | undefined) {
  if (!socket) return;
  try { socket.close(); } catch { /* socket already closed */ }
}

function ipv4(value: string) {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function ipv6(value: string) {
  return value.includes(':') && /^[0-9a-f:]+$/i.test(value) && value.split(':').length >= 3;
}

function normalizeIpToken(value: string) {
  return value.trim().replace(/^[\[('"{]+|[\])'",};]+$/g, '');
}

function extractIp(raw: string) {
  const separator = raw.indexOf('\r\n\r\n');
  const body = separator >= 0 ? raw.slice(separator + 4) : raw;
  for (const part of body.split(/\s+/)) {
    const candidate = normalizeIpToken(part);
    if (ipv4(candidate) || ipv6(candidate)) return candidate;
  }
  const match = body.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  if (match && ipv4(match[0])) return match[0];
  return null;
}

function literalPrivateOrReserved(host: string) {
  const value = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!value) return true;
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local')) return true;

  if (ipv4(value)) {
    const [a, b] = value.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
  }

  if (ipv6(value)) {
    if (value === '::1' || value === '::') return true;
    if (/^f[cd]/i.test(value)) return true;
    if (/^fe[89ab]/i.test(value)) return true;
  }
  return false;
}

function base64Utf8(value: string) {
  const bytes = encoder.encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function httpRequest(username?: string | null, password?: string | null) {
  const lines = [
    `GET http://${PROBE_HOST}/ HTTP/1.1`,
    `Host: ${PROBE_HOST}`,
    'Accept: text/plain',
    'User-Agent: userFLEX-Proxy-Validator/1.0',
    'Connection: close',
    'Proxy-Connection: close',
  ];
  if (username) lines.push(`Proxy-Authorization: Basic ${base64Utf8(`${username}:${password || ''}`)}`);
  return `${lines.join('\r\n')}\r\n\r\n`;
}

function targetHttpRequest() {
  return `GET / HTTP/1.1\r\nHost: ${PROBE_HOST}\r\nAccept: text/plain\r\nUser-Agent: userFLEX-Proxy-Validator/1.0\r\nConnection: close\r\n\r\n`;
}

function httpStatus(raw: string) {
  const firstLine = raw.split('\r\n', 1)[0] || '';
  const match = firstLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

async function openSocket(host: string, port: number, secure: boolean) {
  const socket = connect(
    { hostname: host, port },
    { secureTransport: secure ? 'on' : 'off', allowHalfOpen: false },
  );
  await timeout(socket.opened, PROBE_TIMEOUT_MS, 'Tiempo de espera agotado conectando con el servidor proxy.');
  return socket;
}

async function probeHttp(input: ProxyValidationInput, secure: boolean): Promise<ProbeResult> {
  const started = Date.now();
  let socket: Socket | null = null;
  let reader: SocketReader | null = null;
  const proxyType: 'http' | 'https' = secure ? 'https' : 'http';
  try {
    socket = await openSocket(input.host, input.port, secure);
    reader = new SocketReader(socket.readable);
    await write(socket, httpRequest(input.username, input.password));
    const raw = await reader.textUntilClose();
    const status = httpStatus(raw);
    if (status === null) return { detected: false, proxyType, status: 'invalid', publicIp: null, latencyMs: null, error: null };
    if (status === 407) {
      return {
        detected: true,
        proxyType,
        status: 'invalid',
        publicIp: null,
        latencyMs: Date.now() - started,
        error: 'El proxy respondió, pero rechazó el usuario o la contraseña.',
      };
    }
    const publicIp = extractIp(raw);
    if (status >= 200 && status < 400 && publicIp) {
      return { detected: true, proxyType, status: 'valid', publicIp, latencyMs: Date.now() - started, error: null };
    }
    return {
      detected: true,
      proxyType,
      status: 'invalid',
      publicIp: null,
      latencyMs: Date.now() - started,
      error: `Se detectó ${proxyType.toUpperCase()}, pero no pudo completar la prueba de salida${status ? ` (HTTP ${status})` : ''}.`,
    };
  } catch (error) {
    return { detected: false, proxyType, status: 'invalid', publicIp: null, latencyMs: null, error: cleanError(error) };
  } finally {
    reader?.release();
    closeSocket(socket);
  }
}

function bytes(...values: number[]) {
  return Uint8Array.from(values);
}

async function socksTargetResponse(socket: Socket, reader: SocketReader, started: number, proxyType: 'socks4' | 'socks5'): Promise<ProbeResult> {
  await write(socket, targetHttpRequest());
  const raw = await reader.textUntilClose();
  const status = httpStatus(raw);
  const publicIp = extractIp(raw);
  if (status !== null && status >= 200 && status < 400 && publicIp) {
    return { detected: true, proxyType, status: 'valid', publicIp, latencyMs: Date.now() - started, error: null };
  }
  return {
    detected: true,
    proxyType,
    status: 'invalid',
    publicIp: null,
    latencyMs: Date.now() - started,
    error: `Se detectó ${proxyType.toUpperCase()}, pero no pudo completar la prueba de salida.`,
  };
}

async function probeSocks5(input: ProxyValidationInput): Promise<ProbeResult> {
  const started = Date.now();
  let socket: Socket | null = null;
  let reader: SocketReader | null = null;
  try {
    socket = await openSocket(input.host, input.port, false);
    reader = new SocketReader(socket.readable);
    const hasCredentials = Boolean(input.username || input.password);
    await write(socket, hasCredentials ? bytes(0x05, 0x02, 0x00, 0x02) : bytes(0x05, 0x01, 0x00));
    const greeting = await reader.exact(2);
    if (greeting[0] !== 0x05) return { detected: false, proxyType: 'socks5', status: 'invalid', publicIp: null, latencyMs: null, error: null };
    if (greeting[1] === 0xff) {
      return { detected: true, proxyType: 'socks5', status: 'invalid', publicIp: null, latencyMs: Date.now() - started, error: 'El proxy SOCKS5 no acepta los métodos de autenticación disponibles.' };
    }
    if (greeting[1] === 0x02) {
      const username = encoder.encode(input.username || '');
      const password = encoder.encode(input.password || '');
      if (username.length > 255 || password.length > 255) {
        return { detected: true, proxyType: 'socks5', status: 'invalid', publicIp: null, latencyMs: Date.now() - started, error: 'El usuario o la contraseña SOCKS5 es demasiado largo.' };
      }
      const auth = new Uint8Array(3 + username.length + password.length);
      let offset = 0;
      auth[offset++] = 0x01;
      auth[offset++] = username.length;
      auth.set(username, offset); offset += username.length;
      auth[offset++] = password.length;
      auth.set(password, offset);
      await write(socket, auth);
      const authReply = await reader.exact(2);
      if (authReply[0] !== 0x01 || authReply[1] !== 0x00) {
        return { detected: true, proxyType: 'socks5', status: 'invalid', publicIp: null, latencyMs: Date.now() - started, error: 'El proxy SOCKS5 rechazó el usuario o la contraseña.' };
      }
    } else if (greeting[1] !== 0x00) {
      return { detected: true, proxyType: 'socks5', status: 'invalid', publicIp: null, latencyMs: Date.now() - started, error: `El proxy SOCKS5 solicitó un método de autenticación no compatible (${greeting[1]}).` };
    }

    const domain = encoder.encode(PROBE_HOST);
    const request = new Uint8Array(7 + domain.length);
    request.set([0x05, 0x01, 0x00, 0x03, domain.length], 0);
    request.set(domain, 5);
    request[5 + domain.length] = (PROBE_PORT >> 8) & 0xff;
    request[6 + domain.length] = PROBE_PORT & 0xff;
    await write(socket, request);

    const replyHead = await reader.exact(4);
    if (replyHead[0] !== 0x05) return { detected: false, proxyType: 'socks5', status: 'invalid', publicIp: null, latencyMs: null, error: null };
    if (replyHead[1] !== 0x00) {
      return { detected: true, proxyType: 'socks5', status: 'invalid', publicIp: null, latencyMs: Date.now() - started, error: `SOCKS5 no pudo abrir la conexión de salida (código ${replyHead[1]}).` };
    }
    if (replyHead[3] === 0x01) await reader.exact(4);
    else if (replyHead[3] === 0x04) await reader.exact(16);
    else if (replyHead[3] === 0x03) {
      const size = (await reader.exact(1))[0];
      await reader.exact(size);
    } else {
      return { detected: true, proxyType: 'socks5', status: 'invalid', publicIp: null, latencyMs: Date.now() - started, error: 'SOCKS5 devolvió un formato de dirección desconocido.' };
    }
    await reader.exact(2);
    return await socksTargetResponse(socket, reader, started, 'socks5');
  } catch (error) {
    return { detected: false, proxyType: 'socks5', status: 'invalid', publicIp: null, latencyMs: null, error: cleanError(error) };
  } finally {
    reader?.release();
    closeSocket(socket);
  }
}

async function probeSocks4(input: ProxyValidationInput): Promise<ProbeResult> {
  const started = Date.now();
  let socket: Socket | null = null;
  let reader: SocketReader | null = null;
  try {
    socket = await openSocket(input.host, input.port, false);
    reader = new SocketReader(socket.readable);
    const user = encoder.encode(input.username || '');
    const domain = encoder.encode(PROBE_HOST);
    if (user.length > 255 || domain.length > 255) {
      return { detected: true, proxyType: 'socks4', status: 'invalid', publicIp: null, latencyMs: Date.now() - started, error: 'El usuario SOCKS4 es demasiado largo.' };
    }
    const request = new Uint8Array(10 + user.length + domain.length);
    let offset = 0;
    request[offset++] = 0x04;
    request[offset++] = 0x01;
    request[offset++] = (PROBE_PORT >> 8) & 0xff;
    request[offset++] = PROBE_PORT & 0xff;
    request.set([0x00, 0x00, 0x00, 0x01], offset); offset += 4;
    request.set(user, offset); offset += user.length;
    request[offset++] = 0x00;
    request.set(domain, offset); offset += domain.length;
    request[offset] = 0x00;
    await write(socket, request);

    const reply = await reader.exact(8);
    if (reply[0] !== 0x00 || ![0x5a, 0x5b, 0x5c, 0x5d].includes(reply[1])) {
      return { detected: false, proxyType: 'socks4', status: 'invalid', publicIp: null, latencyMs: null, error: null };
    }
    if (reply[1] !== 0x5a) {
      return { detected: true, proxyType: 'socks4', status: 'invalid', publicIp: null, latencyMs: Date.now() - started, error: `SOCKS4 rechazó la conexión de salida (código ${reply[1]}).` };
    }
    return await socksTargetResponse(socket, reader, started, 'socks4');
  } catch (error) {
    return { detected: false, proxyType: 'socks4', status: 'invalid', publicIp: null, latencyMs: null, error: cleanError(error) };
  } finally {
    reader?.release();
    closeSocket(socket);
  }
}

async function probeSsh(input: ProxyValidationInput): Promise<ProbeResult> {
  const started = Date.now();
  let socket: Socket | null = null;
  let reader: SocketReader | null = null;
  try {
    socket = await openSocket(input.host, input.port, false);
    reader = new SocketReader(socket.readable);
    const raw = await reader.textUntilClose(1024, 2_500);
    const banner = raw.split(/\r?\n/).find((line) => line.startsWith('SSH-')) || '';
    if (!banner) return { detected: false, proxyType: 'ssh', status: 'invalid', publicIp: null, latencyMs: null, error: null };
    return {
      detected: true,
      proxyType: 'ssh',
      status: 'reachable',
      publicIp: null,
      latencyMs: Date.now() - started,
      error: 'Servidor SSH detectado. Se comprobó el puerto y el protocolo, pero no se ejecuta un túnel SSH desde el panel.',
    };
  } catch (error) {
    return { detected: false, proxyType: 'ssh', status: 'invalid', publicIp: null, latencyMs: null, error: cleanError(error) };
  } finally {
    reader?.release();
    closeSocket(socket);
  }
}

function orderForPort(port: number): Array<Exclude<ProxyProtocol, 'unknown'>> {
  if (port === 22 || port === 2222) return ['ssh', 'http', 'socks5', 'socks4', 'https'];
  if ([1080, 1081, 1085].includes(port)) return ['socks5', 'socks4', 'http', 'https', 'ssh'];
  if ([443, 8443, 9443].includes(port)) return ['https', 'http', 'socks5', 'socks4', 'ssh'];
  return ['http', 'socks5', 'socks4', 'https', 'ssh'];
}

async function geolocate(publicIp: string) {
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(publicIp)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'userFLEX-Proxy-Validator/1.0' },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;
    const value: any = await response.json();
    if (value?.success === false) return null;
    const countryCode = typeof value?.country_code === 'string' && /^[A-Za-z]{2}$/.test(value.country_code)
      ? value.country_code.toUpperCase()
      : null;
    return {
      countryCode,
      country: typeof value?.country === 'string' ? value.country.slice(0, 120) : null,
      region: typeof value?.region === 'string' ? value.region.slice(0, 120) : null,
      city: typeof value?.city === 'string' ? value.city.slice(0, 120) : null,
      timezone: typeof value?.timezone?.id === 'string'
        ? value.timezone.id.slice(0, 120)
        : typeof value?.timezone === 'string' ? value.timezone.slice(0, 120) : null,
    };
  } catch {
    return null;
  }
}

async function runProbe(type: Exclude<ProxyProtocol, 'unknown'>, input: ProxyValidationInput) {
  if (type === 'http') return probeHttp(input, false);
  if (type === 'https') return probeHttp(input, true);
  if (type === 'socks5') return probeSocks5(input);
  if (type === 'socks4') return probeSocks4(input);
  return probeSsh(input);
}

export function proxyBrowserCompatible(proxyType: ProxyProtocol, status: ProxyValidationStatus) {
  return status === 'valid' && ['http', 'https', 'socks4', 'socks5'].includes(proxyType);
}

export async function validateProxy(input: ProxyValidationInput): Promise<ProxyValidationResult> {
  const checkedAt = new Date().toISOString();
  if (literalPrivateOrReserved(input.host)) {
    return {
      proxyType: 'unknown',
      status: 'unverifiable',
      checkedAt,
      latencyMs: null,
      publicIp: null,
      countryCode: null,
      country: null,
      region: null,
      city: null,
      timezone: null,
      error: 'Dirección privada o local. Cloudflare no permite abrir TCP hacia redes privadas; debe validarse desde un equipo dentro de esa red.',
      browserCompatible: false,
    };
  }

  let lastError: string | null = null;
  for (const type of orderForPort(input.port)) {
    const result = await runProbe(type, input);
    if (result.error) lastError = result.error;
    if (!result.detected) continue;

    const geo = result.publicIp ? await geolocate(result.publicIp) : null;
    const status = result.status;
    return {
      proxyType: result.proxyType,
      status,
      checkedAt,
      latencyMs: result.latencyMs,
      publicIp: result.publicIp,
      countryCode: geo?.countryCode || null,
      country: geo?.country || null,
      region: geo?.region || null,
      city: geo?.city || null,
      timezone: geo?.timezone || null,
      error: result.error,
      browserCompatible: proxyBrowserCompatible(result.proxyType, status),
    };
  }

  return {
    proxyType: 'unknown',
    status: 'invalid',
    checkedAt,
    latencyMs: null,
    publicIp: null,
    countryCode: null,
    country: null,
    region: null,
    city: null,
    timezone: null,
    error: lastError || 'No se pudo detectar un proxy HTTP, HTTPS, SOCKS4, SOCKS5 o un servidor SSH en ese host y puerto.',
    browserCompatible: false,
  };
}
