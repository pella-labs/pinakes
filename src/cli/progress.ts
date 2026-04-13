/**
 * Progress reporter for long-running CLI operations (D44).
 *
 * Writes phase headers and per-item progress to stderr so it doesn't
 * interfere with structured stdout output or piping.
 */

export interface ProgressReporter {
  startPhase(name: string, total: number): void;
  tick(label: string, detail?: string): void;
  endPhase(summary: string): void;
}

/**
 * Create a progress reporter that writes to stderr.
 * Pass `quiet: true` to suppress all output (for tests or non-TTY).
 */
export function createProgressReporter(opts?: { quiet?: boolean }): ProgressReporter {
  const quiet = opts?.quiet ?? false;
  let phaseStart = 0;
  let current = 0;
  let total = 0;

  return {
    startPhase(name: string, count: number): void {
      total = count;
      current = 0;
      phaseStart = Date.now();
      if (!quiet) {
        process.stderr.write(`${name} (${count} items)...\n`);
      }
    },

    tick(label: string, detail?: string): void {
      current++;
      if (!quiet) {
        const elapsed = ((Date.now() - phaseStart) / 1000).toFixed(1);
        const parts = [`  [${current}/${total}] ${label}`];
        if (detail) parts.push(` — ${detail}`);
        parts.push(` (${elapsed}s)`);
        process.stderr.write(parts.join('') + '\n');
      }
    },

    endPhase(summary: string): void {
      if (!quiet) {
        const elapsed = ((Date.now() - phaseStart) / 1000).toFixed(1);
        process.stderr.write(`  ${summary} (${elapsed}s total)\n\n`);
      }
    },
  };
}
