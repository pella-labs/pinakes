import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { createProgressReporter } from '../../cli/progress.js';
import { isRealGap } from '../../cli/audit-wiki.js';

describe('cli/progress (Phase 9.1 D44)', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('prints correct [n/total] format', () => {
    const p = createProgressReporter();
    p.startPhase('Test phase', 3);
    p.tick('file-a.md', '2 topics');
    p.tick('file-b.md');
    p.tick('file-c.md', '5 topics');
    p.endPhase('done');

    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));

    // startPhase header
    expect(calls[0]).toContain('Test phase');
    expect(calls[0]).toContain('3 items');

    // tick lines have [n/total] format
    expect(calls[1]).toMatch(/\[1\/3\] file-a\.md/);
    expect(calls[1]).toContain('2 topics');
    expect(calls[2]).toMatch(/\[2\/3\] file-b\.md/);
    expect(calls[3]).toMatch(/\[3\/3\] file-c\.md/);
    expect(calls[3]).toContain('5 topics');

    // endPhase summary
    expect(calls[4]).toContain('done');
    expect(calls[4]).toMatch(/\d+\.\d+s total/);
  });

  it('respects quiet mode', () => {
    const p = createProgressReporter({ quiet: true });
    p.startPhase('Silent phase', 2);
    p.tick('item1');
    p.tick('item2');
    p.endPhase('finished');

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('includes elapsed time in tick lines', () => {
    const p = createProgressReporter();
    p.startPhase('Timed', 1);
    p.tick('item');

    const output = String(stderrSpy.mock.calls[1]?.[0] ?? '');
    // Should contain elapsed time like (0.0s)
    expect(output).toMatch(/\(\d+\.\d+s\)/);
  });
});

describe('cli/audit-wiki isRealGap (Phase 9.1 D42)', () => {
  // Should REJECT these garbage topics
  it('rejects common English words', () => {
    for (const word of ['window', 'instead', 'enable', 'default', 'using', 'still', 'based']) {
      expect(isRealGap(word), `should reject "${word}"`).toBe(false);
    }
  });

  it('rejects common technical terms', () => {
    for (const word of ['command', 'description', 'content', 'provider', 'server', 'client',
                        'function', 'method', 'parameter', 'result', 'source', 'model']) {
      expect(isRealGap(word), `should reject "${word}"`).toBe(false);
    }
  });

  it('rejects camelCase identifiers', () => {
    expect(isRealGap('readFileSync')).toBe(false);
    expect(isRealGap('parseJSON')).toBe(false);
    expect(isRealGap('getUserById')).toBe(false);
  });

  it('rejects SCREAMING_SNAKE_CASE', () => {
    expect(isRealGap('MAX_PAIRS')).toBe(false);
    expect(isRealGap('RATE_LIMIT_MS')).toBe(false);
    expect(isRealGap('NODE_ENV')).toBe(false);
  });

  it('rejects qualified names with dots', () => {
    expect(isRealGap('fs.readFileSync')).toBe(false);
    expect(isRealGap('path.join')).toBe(false);
    expect(isRealGap('process.env')).toBe(false);
  });

  it('rejects short topics', () => {
    expect(isRealGap('id')).toBe(false);
    expect(isRealGap('or')).toBe(false);
    expect(isRealGap('no')).toBe(false);
    expect(isRealGap('test')).toBe(false);
  });

  it('rejects single-word lowercase generic terms', () => {
    expect(isRealGap('goosed')).toBe(false);
    expect(isRealGap('sessions')).toBe(false);
    expect(isRealGap('models')).toBe(false);
    expect(isRealGap('desktop')).toBe(false);
  });

  // Should ACCEPT these real topics
  it('accepts proper nouns and acronyms', () => {
    expect(isRealGap('OAuth2')).toBe(true);
    expect(isRealGap('Docker')).toBe(true);
    expect(isRealGap('PostgreSQL')).toBe(true);
    expect(isRealGap('SQLite')).toBe(true);
    expect(isRealGap('Kubernetes')).toBe(true);
  });

  it('accepts multi-word topics', () => {
    expect(isRealGap('knowledge graph')).toBe(true);
    expect(isRealGap('access control')).toBe(true);
    expect(isRealGap('rate limiting')).toBe(true);
    expect(isRealGap('error handling strategy')).toBe(true);
  });
});
