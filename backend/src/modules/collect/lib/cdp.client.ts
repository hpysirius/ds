import * as net from 'net';
import * as crypto from 'crypto';

/**
 * 极简 Chrome DevTools Protocol 客户端。
 *
 * 为什么不用 ws / undici 的 WebSocket：
 * 实测 undici 的 WebSocket 能完成握手（101）但收不到 CDP 回包，
 * 因此这里用 Node 内置 net 模块手写 WebSocket 帧编解码。
 *
 * 另一个坑：页面级 ws 端点（/devtools/page/xxx）在本机 Chrome 上不响应命令，
 * 必须走浏览器级端点（/json/version 里的 webSocketDebuggerUrl），
 * 再用 Target.attachToTarget({ flatten: true }) 拿 sessionId，之后所有命令带 sessionId。
 */
export class CdpClient {
  private sock: net.Socket;
  private seq = 0;
  private pend = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private buf: Buffer = Buffer.alloc(0);
  private raw: Buffer = Buffer.alloc(0);
  private handshaked = false;
  private frag: Buffer[] = [];
  public events: any[] = [];

  constructor(private readonly url: URL) {}

  connect(timeout = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const timer = setTimeout(() => reject(new Error('WebSocket 握手超时')), timeout);

      this.sock = net.connect(Number(this.url.port), this.url.hostname, () => {
        this.sock.write(
          `GET ${this.url.pathname}${this.url.search} HTTP/1.1\r\n` +
            `Host: ${this.url.host}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Key: ${key}\r\n` +
            'Sec-WebSocket-Version: 13\r\n\r\n',
        );
      });

      this.sock.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });

      this.sock.on('data', (d) => {
        if (!this.handshaked) {
          this.raw = Buffer.concat([this.raw, d]);
          const idx = this.raw.indexOf('\r\n\r\n');
          if (idx < 0) return;
          this.handshaked = true;
          clearTimeout(timer);
          const rest = this.raw.subarray(idx + 4);
          this.raw = Buffer.alloc(0);
          this.sock.removeAllListeners('error');
          this.sock.on('error', () => void 0);
          resolve();
          if (rest.length) this.parse(rest);
          return;
        }
        this.parse(d);
      });
    });
  }

  private parse(data: Buffer) {
    let b = Buffer.concat([this.buf, data]);
    this.buf = Buffer.alloc(0);

    for (;;) {
      if (b.length < 2) {
        this.buf = b;
        return;
      }
      const b0 = b[0];
      const b1 = b[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      let off = 2;
      let len = b1 & 0x7f;
      if (len === 126) {
        if (b.length < 4) {
          this.buf = b;
          return;
        }
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) {
          this.buf = b;
          return;
        }
        len = Number(b.readBigUInt64BE(2));
        off = 10;
      }
      if (b.length < off + len) {
        this.buf = b;
        return;
      }

      const payload = b.subarray(off, off + len);
      b = b.subarray(off + len);

      if (op === 0x8) {
        this.sock.end();
        return;
      }
      if (op === 0x9) continue; // ping 帧，忽略

      if (op === 0x0 || op === 0x1 || op === 0x2) {
        this.frag.push(payload);
        if (!fin) continue;
        const msg = Buffer.concat(this.frag).toString('utf8');
        this.frag = [];
        let m: any;
        try {
          m = JSON.parse(msg);
        } catch (e) {
          continue;
        }
        if (m.id && this.pend.has(m.id)) {
          const p = this.pend.get(m.id)!;
          this.pend.delete(m.id);
          p.resolve(m);
        } else if (m.method) {
          this.events.push(m);
          if (this.events.length > 500) this.events.shift();
        }
      }
    }
  }

  private write(str: string) {
    const p = Buffer.from(str, 'utf8');
    let header: Buffer;
    if (p.length < 126) {
      header = Buffer.from([0x81, 0x80 | p.length]);
    } else if (p.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0xfe;
      header.writeUInt16BE(p.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0xff;
      header.writeBigUInt64BE(BigInt(p.length), 2);
    }
    const mask = crypto.randomBytes(4);
    const out = Buffer.alloc(p.length);
    for (let i = 0; i < p.length; i++) out[i] = p[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([header, mask, out]));
  }

  send(method: string, params: any = {}, sessionId?: string, timeout = 60000): Promise<any> {
    const id = ++this.seq;
    const msg: any = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pend.set(id, { resolve, reject });
      this.write(JSON.stringify(msg));
      setTimeout(() => {
        if (this.pend.has(id)) {
          this.pend.delete(id);
          reject(new Error('CDP 命令超时: ' + method));
        }
      }, timeout);
    });
  }

  close() {
    try {
      this.sock.end();
    } catch (e) {
      /* ignore */
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
