/**
 * 安装包自启接线测试：确保「安装即可用」依赖的配置不会在后续改动中丢失。
 * 只校验构建配置与脚本契约，不执行安装器（避免测试机 UAC / 计划任务副作用）。
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  build: {
    nsis: { perMachine?: boolean; include?: string };
    extraResources: { to: string }[];
  };
};

describe('安装包自启接线', () => {
  it('使用管理员安装并引入自定义 NSIS 宏', () => {
    expect(pkg.build.nsis.perMachine).toBe(true);
    expect(pkg.build.nsis.include).toBe('scripts/installer.nsh');
    expect(fs.existsSync(path.join(root, 'scripts/installer.nsh'))).toBe(true);
  });

  it('自启 / 卸载脚本随安装包进入 resources', () => {
    const targets = pkg.build.extraResources.map((item) => item.to);
    expect(targets).toContain('install-autostart.ps1');
    expect(targets).toContain('uninstall-autostart.ps1');
  });

  it('安装 / 卸载宏调用对应脚本', () => {
    const nsh = fs.readFileSync(path.join(root, 'scripts/installer.nsh'), 'utf8');
    expect(nsh).toContain('!macro customInstall');
    expect(nsh).toContain('!macro customUnInstall');
    expect(nsh).toContain('install-autostart.ps1');
    expect(nsh).toContain('uninstall-autostart.ps1');
  });

  it('安装脚本注册登录计划任务并放行固定端口', () => {
    const ps1 = fs.readFileSync(path.join(root, 'scripts/install-autostart.ps1'), 'utf8');
    expect(ps1).toContain('New-ScheduledTaskAction');
    expect(ps1).toContain("'--server'");
    expect(ps1).toContain('New-NetFirewallRule');
    expect(ps1).toContain('27310');
  });
});
