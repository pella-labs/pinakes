import { pino, type Logger, type LoggerOptions } from 'pino';

/**
 * Pino logger for KG-MCP.
 *
 * CRITICAL: MCP stdio transport uses stdout for the JSON-RPC protocol. Every
 * log line must go to stderr — writing to stdout would corrupt the protocol
 * stream and crash the client. Pino's default `destination()` is already
 * stderr when we pass `process.stderr.fd`, and we never pass a custom
 * destination that would route to stdout.
 *
 * Pretty transport is only enabled when:
 *   1. `KG_LOG_LEVEL=debug` or `trace`, AND
 *   2. stderr is a TTY (i.e. a developer is watching in a terminal)
 *
 * In production (Pharos-spawned stdio child, non-TTY), logs stay as newline-
 * delimited JSON for machine consumption.
 */

const level = process.env.KG_LOG_LEVEL ?? 'info';
const isVerbose = level === 'debug' || level === 'trace';
const isTty = process.stderr.isTTY ?? false;
const usePretty = isVerbose && isTty;

const baseOptions: LoggerOptions = {
  level,
  base: {
    service: 'kg-mcp',
    pid: process.pid,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

function createLogger(): Logger {
  if (usePretty) {
    // With a transport, pino offloads to a worker; the transport target itself
    // writes to stderr via `destination: 2`.
    return pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          destination: 2, // stderr
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname,service',
        },
      },
    });
  }
  // Default path: write NDJSON directly to stderr so stdout stays clean for
  // the MCP JSON-RPC protocol. `process.stderr` satisfies pino's
  // DestinationStream contract.
  return pino(baseOptions, process.stderr);
}

export const logger: Logger = createLogger();

export function child(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
