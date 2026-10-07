/**
 * 服务器地址与客户端形态的纯函数工具（无 DOM / 网络依赖，便于单测）。
 *
 * 客户端不再于启动时绑定地址：由「连接服务器」板块选择目标服务器（自动搜索 / 手动输入），
 * 这里提供地址解析、网段推导与「浏览器 or 桌面客户端」判定等最小逻辑。
 */

/** 服务器地址（WebSocket 目标） */
export interface ServerAddr {
  host: string;
  port: number;
}

/** 缺省端口（与中心服务器默认一致） */
export const DEFAULT_PORT = 7777;

const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * 解析用户输入的服务器地址，允许以下写法：
 * `192.168.1.5`、`192.168.1.5:7777`、`http://192.168.1.5:7777/`、`ws://host:port/ws`
 * 非法输入返回 null。
 */
export function parseAddress(text: string, defaultPort = DEFAULT_PORT): ServerAddr | null {
  const raw = (text ?? '').trim();
  if (!raw) return null;
  const body = raw.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, '').split('/')[0];
  let host = body;
  let port = defaultPort;
  const m = /^(.*?):(\d+)$/.exec(body);
  if (m) {
    host = m[1];
    port = Number(m[2]);
  }
  host = host.trim();
  if (!host || !HOST_RE.test(host)) return null;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}

/** 服务器的唯一键（列表去重用，大小写不敏感） */
export function serverKey(a: ServerAddr): string {
  return `${a.host.toLowerCase()}:${a.port}`;
}

/** 取 IPv4 的前三段作为 /24 网段前缀；非法或回环地址返回 null */
export function subnetPrefix(ip: string): string | null {
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec((ip ?? '').trim());
  if (!m) return null;
  return m[1].startsWith('127.') ? null : m[1];
}

/** 页面自身所在地址对应的服务器（浏览器打开时即服务器地址） */
export function pageServer(hostname: string, port: string, protocol: string): ServerAddr {
  const parsed = Number(port);
  const fallback = protocol === 'https:' ? 443 : 80;
  return {
    host: hostname || '127.0.0.1',
    port: Number.isInteger(parsed) && parsed > 0 ? parsed : fallback,
  };
}

/** 读取查询参数（解析失败时返回空串） */
function queryParam(search: string, name: string): string {
  try {
    return new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get(name) ?? '';
  } catch {
    return '';
  }
}

/**
 * 是否桌面客户端（Electron）：只认 URL 参数 `client=electron`（由 Electron 入口附加）。
 * 浏览器打开时参数缺失 → false，此时「连接服务器」板块锁定为访问地址。
 */
export function isDesktopClient(search: string): boolean {
  return queryParam(search, 'client') === 'electron';
}
