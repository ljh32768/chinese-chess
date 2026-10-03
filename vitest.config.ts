import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 测试默认静音主机日志，需要断言的用例自行 stubEnv 打开
    env: { LANSCHESS_DEBUG: '0' },
  },
});
