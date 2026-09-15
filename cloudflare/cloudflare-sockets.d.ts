declare module 'cloudflare:sockets' {
  export type SecureTransport = 'off' | 'on' | 'starttls';

  export interface SocketAddress {
    hostname: string;
    port: number;
  }

  export interface SocketOptions {
    secureTransport?: SecureTransport;
    allowHalfOpen?: boolean;
  }

  export interface SocketInfo {
    remoteAddress?: string;
    localAddress?: string;
  }

  export interface Socket {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    opened: Promise<SocketInfo>;
    closed: Promise<void>;
    close(): void;
    startTls(): Socket;
  }

  export function connect(address: SocketAddress | string, options?: SocketOptions): Socket;
}
