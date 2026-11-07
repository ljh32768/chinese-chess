/**
 * 服务器地址工具测试：地址解析、网段推导、服务器键与「浏览器 / 桌面客户端」判定。
 * 这些纯函数支撑「连接服务器」板块（自动搜索 + 手动输入 + 状态着色）。
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT as SHARED_DEFAULT_PORT } from '../src/shared/defaults.js';
import {
  DEFAULT_PORT,
  isDesktopClient,
  pageServer,
  parseAddress,
  serverKey,
  subnetPrefix,
} from '../src/renderer/servers.js';

describe('缺省端口', () => {
  it('固定为不常用的 27310，且渲染层与服务端同源', () => {
    expect(DEFAULT_PORT).toBe(27310);
    expect(DEFAULT_PORT).toBe(SHARED_DEFAULT_PORT);
  });
});

describe('服务器地址解析 parseAddress', () => {
  it('支持 host、host:port、带协议与路径的写法', () => {
    expect(parseAddress('192.168.1.42')).toEqual({ host: '192.168.1.42', port: DEFAULT_PORT });
    expect(parseAddress('192.168.1.42:8888')).toEqual({ host: '192.168.1.42', port: 8888 });
    expect(parseAddress('http://192.168.1.42:8888/')).toEqual({ host: '192.168.1.42', port: 8888 });
    expect(parseAddress('ws://192.168.1.42:8888/ws')).toEqual({ host: '192.168.1.42', port: 8888 });
    expect(parseAddress('  chess-box  ')).toEqual({ host: 'chess-box', port: DEFAULT_PORT });
  });

  it('非法输入返回 null', () => {
    expect(parseAddress('')).toBeNull();
    expect(parseAddress('   ')).toBeNull();
    expect(parseAddress(':7777')).toBeNull();
    expect(parseAddress('192.168.1.42:0')).toBeNull();
    expect(parseAddress('192.168.1.42:99999')).toBeNull();
    expect(parseAddress('192.168.1.42:abc')).toBeNull();
    expect(parseAddress('a b:7777')).toBeNull();
  });
});

describe('网段推导 subnetPrefix', () => {
  it('取前三段，回环与非 IPv4 返回 null', () => {
    expect(subnetPrefix('192.168.1.42')).toBe('192.168.1');
    expect(subnetPrefix('10.0.0.7')).toBe('10.0.0');
    expect(subnetPrefix('127.0.0.1')).toBeNull();
    expect(subnetPrefix('localhost')).toBeNull();
    expect(subnetPrefix('')).toBeNull();
  });
});

describe('服务器键 serverKey', () => {
  it('忽略主机名大小写，端口参与区分', () => {
    expect(serverKey({ host: 'LANBOX', port: 7777 })).toBe(serverKey({ host: 'lanbox', port: 7777 }));
    expect(serverKey({ host: 'lanbox', port: 7777 })).not.toBe(serverKey({ host: 'lanbox', port: 8888 }));
  });
});

describe('页面自身地址 pageServer', () => {
  it('带端口时取端口；缺省按协议回退 80 / 443', () => {
    expect(pageServer('192.168.1.42', '7777', 'http:')).toEqual({ host: '192.168.1.42', port: 7777 });
    expect(pageServer('example.local', '', 'http:')).toEqual({ host: 'example.local', port: 80 });
    expect(pageServer('example.local', '', 'https:')).toEqual({ host: 'example.local', port: 443 });
    expect(pageServer('', '', 'http:')).toEqual({ host: '127.0.0.1', port: 80 });
  });
});

describe('客户端形态判定 isDesktopClient', () => {
  it('URL 参数 client=electron 时视为桌面客户端', () => {
    expect(isDesktopClient('?client=electron&server=1.2.3.4:7777')).toBe(true);
    expect(isDesktopClient('client=electron')).toBe(true);
  });

  it('浏览器打开（无该参数）时为 false，服务器板块锁定为访问地址', () => {
    expect(isDesktopClient('')).toBe(false);
    expect(isDesktopClient('?client=browser')).toBe(false);
  });
});
