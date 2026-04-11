import { describe, it, expect } from 'vitest';
import { dedupResults, _toBigrams, _jaccardSimilarity } from '../../retrieval/dedup.js';
import type { HybridResult } from '../../retrieval/hybrid.js';

function makeResult(id: string, sourceUri: string, text: string, score: number): HybridResult {
  return {
    id,
    text,
    source_uri: sourceUri,
    node_id: `node-${id}`,
    score,
    confidence: 'high',
    title: null,
    section_path: '/',
  };
}

describe('dedupResults', () => {
  it('caps results from the same source_uri at 2', () => {
    const results = [
      makeResult('a1', 'auth.md', 'Password hashing with bcrypt', 0.05),
      makeResult('a2', 'auth.md', 'Session management overview', 0.04),
      makeResult('a3', 'auth.md', 'OAuth2 integration guide', 0.03),
      makeResult('a4', 'auth.md', 'Token refresh flow', 0.02),
      makeResult('a5', 'auth.md', 'Two factor authentication', 0.01),
    ];

    const deduped = dedupResults(results);
    expect(deduped.length).toBe(2);
    // Highest-scored ones kept
    expect(deduped[0].id).toBe('a1');
    expect(deduped[1].id).toBe('a2');
  });

  it('drops near-duplicate text (Jaccard > 0.85)', () => {
    const text = 'The authentication system uses bcrypt for password hashing with a cost factor of 12';
    const nearDup = 'The authentication system uses bcrypt for password hashing with a cost factor of 14';
    const distinct = 'Database schema migrations run on startup before the server accepts connections';

    const results = [
      makeResult('a', 'auth.md', text, 0.05),
      makeResult('b', 'security.md', nearDup, 0.04),
      makeResult('c', 'db.md', distinct, 0.03),
    ];

    const deduped = dedupResults(results);
    // Near-dup b should be dropped
    expect(deduped.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('preserves distinct texts below threshold', () => {
    const results = [
      makeResult('a', 'auth.md', 'Password hashing uses bcrypt with cost 12', 0.05),
      makeResult('b', 'db.md', 'Database migrations run sequentially at startup', 0.04),
      makeResult('c', 'api.md', 'REST endpoints follow resource naming conventions', 0.03),
    ];

    const deduped = dedupResults(results);
    expect(deduped.length).toBe(3);
  });

  it('handles empty input', () => {
    expect(dedupResults([])).toEqual([]);
  });

  it('full pipeline: mixed source_uris with near-duplicates', () => {
    const results = [
      makeResult('a1', 'auth.md', 'Authentication uses bcrypt for hashing passwords securely', 0.10),
      makeResult('b1', 'security.md', 'Security policy requires bcrypt for hashing passwords securely', 0.09),
      makeResult('a2', 'auth.md', 'Session tokens are JWT with RS256 signing', 0.08),
      makeResult('a3', 'auth.md', 'OAuth2 provider integration with Google', 0.07),
      makeResult('c1', 'db.md', 'PostgreSQL connection pool configuration', 0.06),
      makeResult('a4', 'auth.md', 'Rate limiting on login endpoints', 0.05),
      makeResult('c2', 'db.md', 'Database migration versioning strategy', 0.04),
      makeResult('c3', 'db.md', 'Query optimization with prepared statements', 0.03),
    ];

    const deduped = dedupResults(results);

    // a1 kept (auth.md #1)
    // b1 might be dropped by Jaccard against a1 (depends on similarity)
    // a2 kept (auth.md #2)
    // a3 dropped by layer 3 (auth.md already has 2)
    // c1 kept (db.md #1)
    // a4 dropped (auth.md at cap)
    // c2 kept (db.md #2)
    // c3 dropped (db.md at cap)

    // Verify no source_uri has more than 2 results
    const uriCounts = new Map<string, number>();
    for (const r of deduped) {
      uriCounts.set(r.source_uri, (uriCounts.get(r.source_uri) ?? 0) + 1);
    }
    for (const [, count] of uriCounts) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('preserves rank order (descending score)', () => {
    const results = [
      makeResult('a', 'a.md', 'First result with highest score', 0.10),
      makeResult('b', 'b.md', 'Second result with medium score', 0.05),
      makeResult('c', 'c.md', 'Third result with lowest score', 0.01),
    ];

    const deduped = dedupResults(results);
    for (let i = 1; i < deduped.length; i++) {
      expect(deduped[i].score).toBeLessThanOrEqual(deduped[i - 1].score);
    }
  });
});

describe('toBigrams', () => {
  it('produces correct bigrams from text', () => {
    const bigrams = _toBigrams('hello world foo');
    expect(bigrams.size).toBe(2);
    expect(bigrams.has('hello world')).toBe(true);
    expect(bigrams.has('world foo')).toBe(true);
  });

  it('handles single word', () => {
    const bigrams = _toBigrams('hello');
    expect(bigrams.size).toBe(1);
    expect(bigrams.has('hello')).toBe(true);
  });
});

describe('jaccardSimilarity', () => {
  it('identical sets have similarity 1.0', () => {
    const a = new Set(['a b', 'b c']);
    expect(_jaccardSimilarity(a, a)).toBe(1);
  });

  it('disjoint sets have similarity 0.0', () => {
    const a = new Set(['a b']);
    const b = new Set(['c d']);
    expect(_jaccardSimilarity(a, b)).toBe(0);
  });

  it('partially overlapping sets have correct similarity', () => {
    const a = new Set(['a b', 'b c', 'c d']);
    const b = new Set(['a b', 'b c', 'd e']);
    // intersection = 2, union = 4
    expect(_jaccardSimilarity(a, b)).toBe(0.5);
  });
});
