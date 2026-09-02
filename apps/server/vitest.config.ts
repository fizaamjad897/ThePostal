import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Configuration is validated at import time, so it has to exist before any
    // module under test is loaded — hence `env` here rather than a setup file.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/postal-test',
      JWT_SECRET: 'test-secret-value-that-is-long-enough-to-pass-validation',
      MAIL_DOMAIN: 'postal.test',
      SMTP_HOSTNAME: 'mx.postal.test',
      SMTP_INGRESS_ENABLED: 'false',
      SMTP_TLS_POLICY: 'disabled',
      SMTP_RELAY_HOST: '127.0.0.1',
      SMTP_RELAY_PORT: '31025',
      DELIVERY_BACKOFF_MS: '1000',
      COOKIE_SECURE: 'false',
    },
    // Each file gets its own in-memory MongoDB, and the SMTP tests bind a fixed
    // port. Running files in parallel would make them collide.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
  },
});
