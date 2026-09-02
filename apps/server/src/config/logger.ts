import { pino, type LoggerOptions } from 'pino';
import { env, isProduction, isTest } from './env.js';

/**
 * Fields that must never reach the log sink. Credentials and message bodies are
 * redacted at the logger rather than at each call site, so a careless
 * `log.info({ body })` somewhere cannot leak them.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'body',
  '*.body',
];

const options: LoggerOptions = {
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  base: { service: 'postal-server' },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Pretty output is a development affordance; production emits newline-delimited
  // JSON so a log shipper can parse it without a transform.
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' },
      },
};

export const logger = pino(options);

export type Logger = typeof logger;
