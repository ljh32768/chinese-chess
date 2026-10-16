import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 服务端用例会真实起 HTTP/WebSocket 服务，机器繁忙时握手与定时器会变慢，
    // 因此放宽单用例超时（默认 5s 在高负载下偶发超时）
    testTimeout: 15000,
    // 测试默认静音服务器日志，需要断言的用例自行 stubEnv 打开；
    // 默认禁用皮卡鱼（避免用例依赖本机引擎文件），需要真机引擎的用例直接构造 PikafishEngine
    env: { LANSCHESS_DEBUG: '0', LANSCHESS_ENGINE: 'off' },
  },
});
