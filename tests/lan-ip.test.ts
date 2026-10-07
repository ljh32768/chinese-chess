import { describe, expect, it } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { pickLanIp } from '../src/server/server.js';

/** 构造网卡信息 */
function iface(address: string, family: 'IPv4' | 'IPv6' = 'IPv4'): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family,
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: `${address}/24`,
  } as NetworkInterfaceInfo;
}

const loopback = (): NetworkInterfaceInfo =>
  ({
    address: '127.0.0.1',
    netmask: '255.0.0.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal: true,
    cidr: '127.0.0.1/8',
  }) as NetworkInterfaceInfo;

describe('本机局域网地址选择', () => {
  it('没有可用网卡时返回 null', () => {
    expect(pickLanIp({})).toBeNull();
    expect(pickLanIp({ lo: [loopback()] })).toBeNull();
  });

  it('优先选择 192.168 网段', () => {
    expect(
      pickLanIp({
        vEthernet: [iface('172.20.48.1')],
        eth0: [iface('192.168.1.42')],
      }),
    ).toBe('192.168.1.42');
  });

  it('跳过虚拟网卡（即使它是唯一候选）', () => {
    const ip = pickLanIp({
      vEthernet: [iface('172.20.48.1')],
      以太网: [iface('10.0.0.7')],
    });
    expect(ip).toBe('10.0.0.7');
  });

  it('忽略 IPv6', () => {
    expect(pickLanIp({ eth0: [iface('fe80::1', 'IPv6')] })).toBeNull();
    expect(pickLanIp({ eth0: [iface('fe80::1', 'IPv6'), iface('192.168.3.5')] })).toBe('192.168.3.5');
  });

  it('只有虚拟网卡时仍会返回它（避免无法联机）', () => {
    expect(pickLanIp({ vEthernet: [iface('172.20.48.1')] })).toBe('172.20.48.1');
  });
});
