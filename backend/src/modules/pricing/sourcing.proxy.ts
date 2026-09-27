/**
 * 1688 抓取的「换出口 IP」通道 —— 零依赖实现（只用 Node 内置 http / tls / zlib）。
 *
 * 为什么需要：云服务器（机房）IP 段被 1688 标记为风险来源，抓详情页会返回约 600 字节的
 * x5secdata 滑块页，换 UA / 补全 sec-ch-ua 之类的请求头都没用（实测），是 IP 信誉层面的拦截。
 * 唯一有效的办法是换出口 IP，也就是走代理。
 *
 * 支持：
 *  - http://user:pass@host:port 形式的 HTTP 代理（住宅代理 / 动态 IP 代理一般都提供这种）
 *  - https 目标走 CONNECT 隧道，http 目标直接把绝对 URL 交给代理
 *  - 自动跟随重定向（最多 3 跳）、自动解压 gzip / deflate / br
 *
 * 不支持 socks5（需要就再装 socks-proxy-agent，这里为了零依赖不做）。
 */

import * as http from 'node:http';
import * as https from 'node:https';
import * as tls from 'node:tls';
import * as zlib from 'node:zlib';

export interface ProxyResult {
  status: number;
  body: string;
  finalUrl: string;
}

function decompress(buf: Buffer, encoding?: string): string {
  try {
    if (encoding === 'gzip' || encoding === 'x-gzip') return zlib.gunzipSync(buf).toString('utf8');
    if (encoding === 'deflate') return zlib.inflateSync(buf).toString('utf8');
    if (encoding === 'br') return zlib.brotliDecompressSync(buf).toString('utf8');
  } catch (e) {
    /* 解压失败就用原始字节，交给上层判断 */
  }
  return buf.toString('utf8');
}

function basicAuth(proxyUrl: URL): string | null {
  if (!proxyUrl.username) return null;
  const user = decodeURIComponent(proxyUrl.username);
  const pass = decodeURIComponent(proxyUrl.password || '');
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

/** 单跳请求（不跟随重定向） */
function once(
  url: string,
  proxyUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<ProxyResult> {
  const target = new URL(url);
  const proxy = new URL(proxyUrl);
  const auth = basicAuth(proxy);
  const isHttps = target.protocol === 'https:';
  const targetPort = Number(target.port || (isHttps ? 443 : 80));
  const proxyPort = Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80));

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error('代理请求超时'))), timeoutMs);

    const fire = (socket?: any) => {
      const mod: any = isHttps ? https : http;
      const opts: any = {
        method: 'GET',
        headers: { ...headers, Host: target.host },
        timeout: timeoutMs,
      };
      if (isHttps) {
        opts.host = target.hostname;
        opts.port = targetPort;
        opts.path = target.pathname + target.search;
        opts.servername = target.hostname;
        // 关键：走已经建好的 CONNECT 隧道，而不是重新连目标主机
        opts.createConnection = () => socket;
      } else {
        // 明文 http：把绝对 URL 直接交给代理
        opts.host = proxy.hostname;
        opts.port = proxyPort;
        opts.path = url;
        if (auth) opts.headers['Proxy-Authorization'] = auth;
      }
      const req = mod.request(opts, (res: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const loc = res.headers?.location;
          done(() =>
            resolve({
              status: res.statusCode || 0,
              body: decompress(buf, String(res.headers?.['content-encoding'] || '')),
              finalUrl: loc ? new URL(loc, url).toString() : url,
            }),
          );
        });
        res.on('error', (e: any) => done(() => reject(e)));
      });
      req.on('error', (e: any) => done(() => reject(e)));
      req.on('timeout', () => {
        req.destroy();
        done(() => reject(new Error('代理请求超时')));
      });
      req.end();
    };

    if (!isHttps) {
      fire();
      return;
    }

    // https 目标：先让代理开一条到目标主机的 CONNECT 隧道
    const conn = http.request({
      host: proxy.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${target.hostname}:${targetPort}`,
      headers: {
        Host: `${target.hostname}:${targetPort}`,
        ...(auth ? { 'Proxy-Authorization': auth } : {}),
      },
      timeout: timeoutMs,
    });
    conn.on('connect', (res: any, socket: any) => {
      if (res.statusCode !== 200) {
        socket?.destroy?.();
        done(() => reject(new Error(`代理 CONNECT 失败：${res.statusCode}`)));
        return;
      }
      const tlsSocket = tls.connect({ socket, servername: target.hostname }, () => fire(tlsSocket));
      tlsSocket.on('error', (e: any) => done(() => reject(e)));
    });
    conn.on('error', (e: any) => done(() => reject(e)));
    conn.on('timeout', () => {
      conn.destroy();
      done(() => reject(new Error('代理 CONNECT 超时')));
    });
    conn.end();
  });
}

/** 带重定向跟随的代理 GET，形态与 httpGet 返回的 Fetched 对齐 */
export async function proxyGet(
  url: string,
  proxyUrl: string,
  headers: Record<string, string>,
  timeoutMs = 12000,
): Promise<ProxyResult> {
  let cur = url;
  let last: ProxyResult = { status: 0, body: '', finalUrl: url };
  for (let i = 0; i < 3; i++) {
    last = await once(cur, proxyUrl, headers, timeoutMs);
    const isRedirect = last.status >= 300 && last.status < 400;
    if (!isRedirect || !last.finalUrl || last.finalUrl === cur) break;
    cur = last.finalUrl;
  }
  return { ...last, finalUrl: cur };
}
