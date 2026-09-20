import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

/**
 * 浏览器接管服务。
 *
 * 采集的数据来自「中实跨境ERP」插件注入到 Ozon 商品卡片上的 data-s2-card-data-json 属性，
 * 所以必须连上用户自己那个装了插件、登了号的 Chrome。这里封装了全部踩过的坑：
 *   1. Chrome 不允许在默认配置目录上开调试端口（日志：DevTools remote debugging
 *      requires a non-default data directory）→ 必须复制一份 user-data-dir
 *   2. 在受限环境里直接 exec Chrome 会 sandbox initialization failed → 用包装 .app + open 启动
 *   3. AppleScript / launchctl 都会被系统拦（-10004 / I/O error）→ 不用它们
 */
@Injectable()
export class BrowserService {
  private readonly logger = new Logger(BrowserService.name);

  constructor(private readonly config: ConfigService) {}

  private get port(): number {
    return Number(this.config.get('CHROME_DEBUG_PORT') || 9222);
  }

  private get profileDir(): string {
    return this.config.get('CHROME_DEBUG_PROFILE') || '/tmp/chrome_debug_profile';
  }

  private get appDir(): string {
    return this.config.get('CHROME_APP_PATH') || '/tmp/ChromeDebug.app';
  }

  private get chromeBin(): string {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }

  private get realProfile(): string {
    return path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
  }

  portUp(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        { host: '127.0.0.1', port: this.port, path: '/json/version', timeout: 1500 },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve(body.includes('Browser')));
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  chromeRunning(): boolean {
    try {
      return (
        execSync('pgrep -x "Google Chrome" >/dev/null && echo yes || echo no', { shell: '/bin/bash' })
          .toString()
          .trim() === 'yes'
      );
    } catch (e) {
      return false;
    }
  }

  profileReady(): boolean {
    return fs.existsSync(path.join(this.profileDir, 'Default'));
  }

  /** 生成包装 app，让 open 以「非沙箱」方式带参数启动 Chrome */
  writeWrapperApp() {
    fs.mkdirSync(path.join(this.appDir, 'Contents/MacOS'), { recursive: true });
    const script =
      '#!/bin/bash\n' +
      `exec "${this.chromeBin}" --remote-debugging-port=${this.port} --remote-allow-origins=* ` +
      `--user-data-dir=${this.profileDir} --no-first-run --no-default-browser-check ` +
      /*
       * 防节流：浏览器被别的窗口盖住/不在最前时，Chrome 会节流甚至冻结后台标签的渲染进程，
       * 表现就是 CDP 求值一直超时、页面永远加载不出来（采集卡死的真凶之一）。
       */
      '--disable-background-timer-throttling --disable-backgrounding-occluded-windows ' +
      '--disable-renderer-backgrounding --disable-features=CalculateNativeWinOcclusion\n';
    fs.writeFileSync(path.join(this.appDir, 'Contents/MacOS/ChromeDebug'), script, { mode: 0o755 });
    fs.writeFileSync(
      path.join(this.appDir, 'Contents/Info.plist'),
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
        '<plist version="1.0"><dict>\n' +
        '<key>CFBundleExecutable</key><string>ChromeDebug</string>\n' +
        '<key>CFBundleIdentifier</key><string>com.local.chromedebug</string>\n' +
        '<key>CFBundleName</key><string>ChromeDebug</string>\n' +
        '<key>CFBundlePackageType</key><string>APPL</string>\n' +
        '<key>CFBundleVersion</key><string>1.0</string>\n' +
        '</dict></plist>\n',
    );
  }

  async status() {
    const portUp = await this.portUp();
    const running = this.chromeRunning();
    let version: any = null;
    if (portUp) {
      try {
        version = await (await fetch(`http://127.0.0.1:${this.port}/json/version`)).json();
      } catch (e) {
        version = null;
      }
    }
    return {
      portUp,
      port: this.port,
      chromeRunning: running,
      profileReady: this.profileReady(),
      profileDir: this.profileDir,
      browser: version?.Browser || null,
    };
  }

  /** 确保带调试端口的 Chrome 处于可用状态，必要时自动准备配置并启动 */
  async ensure(): Promise<{ ok: boolean; msg: string; logs: string[] }> {
    const logs: string[] = [];
    const push = (m: string) => {
      this.logger.log(m);
      logs.push(m);
    };

    if (await this.portUp()) return { ok: true, msg: '调试端口已就绪', logs };

    const needCopy = !this.profileReady();

    if (needCopy) {
      // 只有「第一次要复制配置」时才需要用户退出 Chrome（Chrome 在跑时配置目录可能被写）
      if (this.chromeRunning()) {
        return {
          ok: false,
          msg:
            '首次使用需要复制一份 Chrome 配置（带上你的登录态），请先完全退出 Chrome（Cmd+Q）后再点一次；' +
            '这件事只做一次，之后就再也不用退出了。',
          logs,
        };
      }
      push('首次运行：复制 Chrome 配置（保留插件与登录态，约 40 秒）…');
      fs.mkdirSync(this.profileDir, { recursive: true });
      const excludes = [
        'Code Cache',
        'Cache',
        'GPUPersistentCache',
        'GrShaderCache',
        'ShaderCache',
        'BrowserMetrics*',
        'Crashpad*',
        '*component_crx_cache*',
      ]
        .map((e) => `--exclude='${e}'`)
        .join(' ');
      execSync(`rsync -a ${excludes} '${this.realProfile}/' '${this.profileDir}/'`, { shell: '/bin/bash' });
      push('配置复制完成');
    } else {
      /*
       * 配置已经是独立的 user-data-dir 了，所以**不需要**用户退出正在运行的 Chrome：
       * 调试实例和常规实例是两份目录，可以并存（实测：常规 Chrome 开着也能起来）。
       * 原来那种「Chrome 在跑就拒绝启动」的守卫太严，导致每次都要手动去页面点。
       */
      if (this.chromeRunning()) push('检测到你自己的 Chrome 也在运行 —— 不影响，调试实例用的是独立配置目录');
    }

    this.writeWrapperApp();
    push('自动启动带调试端口的 Chrome…');
    execSync(`open "${this.appDir}"`, { shell: '/bin/bash' });

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await this.portUp()) {
        push('浏览器已就绪');
        return { ok: true, msg: '已自动启动', logs };
      }
    }
    return { ok: false, msg: '启动超时，请检查 Chrome 是否被其它进程占用', logs };
  }

  /** 给「找货源」这类流程用：需要浏览器时自动拉起，不满足条件才报错 */
  async ensureReady(): Promise<void> {
    const st = await this.status();
    if (st.portUp) return;
    const r = await this.ensure();
    if (!r.ok) throw new Error(r.msg);
  }

  async version() {
    return fetch(`http://127.0.0.1:${this.port}/json/version`).then((r) => r.json());
  }

  /** 关闭当前调试实例的 Chrome（仅关闭带调试端口的那个进程） */
  stop() {
    try {
      execSync('pkill -f "user-data-dir=/tmp/chrome_debug_profile"', { shell: '/bin/bash' });
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  }
}
