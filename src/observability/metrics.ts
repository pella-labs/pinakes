/**
 * In-process metrics counters with SIGHUP dump.
 *
 * CLAUDE.md §Phase 7: "Metrics dump on SIGHUP: emit all counters as a
 * single JSON line to stderr."
 *
 * All counters are monotonic (never reset). The SIGHUP handler snapshots
 * everything and writes it to stderr as NDJSON so it doesn't collide with
 * the MCP stdio protocol on stdout.
 */

import { logger } from './logger.js';

export interface LatencyBucket {
  count: number;
  sum: number;
  max: number;
}

export interface MetricsSnapshot {
  tool_calls: Record<string, number>;
  tool_errors: Record<string, number>;
  tool_latency_ms: Record<string, LatencyBucket>;
  ingest_files: number;
  ingest_errors: number;
  uptime_s: number;
}

class Metrics {
  private toolCalls = new Map<string, number>();
  private toolErrors = new Map<string, number>();
  private toolLatency = new Map<string, LatencyBucket>();
  private ingestFiles = 0;
  private ingestErrors = 0;
  private readonly startedAt = Date.now();

  recordToolCall(tool: string, latencyMs: number, error?: boolean): void {
    this.toolCalls.set(tool, (this.toolCalls.get(tool) ?? 0) + 1);
    if (error) {
      this.toolErrors.set(tool, (this.toolErrors.get(tool) ?? 0) + 1);
    }
    const lat = this.toolLatency.get(tool) ?? { count: 0, sum: 0, max: 0 };
    lat.count++;
    lat.sum += latencyMs;
    lat.max = Math.max(lat.max, latencyMs);
    this.toolLatency.set(tool, lat);
  }

  recordIngest(error?: boolean): void {
    if (error) this.ingestErrors++;
    else this.ingestFiles++;
  }

  snapshot(): MetricsSnapshot {
    return {
      tool_calls: Object.fromEntries(this.toolCalls),
      tool_errors: Object.fromEntries(this.toolErrors),
      tool_latency_ms: Object.fromEntries(this.toolLatency),
      ingest_files: this.ingestFiles,
      ingest_errors: this.ingestErrors,
      uptime_s: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }
}

export const metrics = new Metrics();

/**
 * Install SIGHUP handler to dump metrics as a single JSON line to stderr.
 * Safe to call multiple times — only installs once.
 */
let sighupInstalled = false;
export function installSighupHandler(): void {
  if (sighupInstalled) return;
  sighupInstalled = true;
  process.on('SIGHUP', () => {
    const snap = metrics.snapshot();
    // Write directly to stderr to avoid pino's async buffering.
    process.stderr.write(JSON.stringify({ pinakes_metrics: snap }) + '\n');
    logger.info('SIGHUP: metrics dumped to stderr');
  });
}
