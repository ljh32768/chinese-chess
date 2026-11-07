/**
 * 桌面客户端「本机服务」开关的共享类型与纯函数。
 *
 * 本机服务 = 本机作为局域网中心服务器（默认端口 27310）：
 * - 安装包注册 Windows 计划任务 `LanChessServer`（登录自启）；开关关闭时停掉服务进程并写入关闭偏好，
 *   自启进程读到偏好会直接退出（无需管理员权限改计划任务）；
 * - 开发 / 绿色版没有计划任务时，由客户端内置托管同端口服务器（关闭即释放端口）。
 * 渲染层通过本机外壳服务的 `/api/local-service` 查询与切换。
 */

/** 安装包注册的计划任务名（与 scripts/install-autostart.ps1 保持一致） */
export const LOCAL_SERVICE_TASK_NAME = 'LanChessServer';

/** 当前由谁托管本机服务：计划任务 / 客户端内置 / 其它进程（无法从客户端关闭） */
export type LocalServiceMode = 'task' | 'builtin' | 'external';

export interface LocalServiceStatus {
  /** 当前平台是否支持本机服务开关 */
  supported: boolean;
  /** 开关是否开启（服务应处于运行状态） */
  enabled: boolean;
  /** 服务是否正在监听本机端口 */
  running: boolean;
  /** 托管方式 */
  mode: LocalServiceMode;
  /** 本地服务端口 */
  port: number;
  /** 状态说明 / 失败原因（可选） */
  message?: string;
}

/** 主进程提供给本机外壳服务的控制端口（远端服务器不提供） */
export interface LocalServiceController {
  status(): Promise<LocalServiceStatus>;
  setEnabled(enabled: boolean): Promise<LocalServiceStatus>;
}

/** 本机服务开关的本机偏好：缺省开启（文件缺失 / 损坏也按开启处理） */
export function parseLocalServicePref(raw: string | null): boolean {
  if (!raw) return true;
  try {
    const data = JSON.parse(raw) as { enabled?: unknown } | null;
    return data?.enabled !== false;
  } catch {
    return true;
  }
}
