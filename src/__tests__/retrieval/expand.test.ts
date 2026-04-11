import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  expandQuery,
  __clearExpansionCacheForTests,
} from '../../retrieval/expand.js';
import type { LlmProvider } from '../../llm/provider.js';

function mockProvider(response: string): LlmProvider {
  return {
    name: 'mock',
    available: () => true,
    complete: vi.fn().mockResolvedValue(response),
  };
}

function disabledProvider(): LlmProvider {
  return {
    name: 'disabled',
    available: () => false,
    complete: vi.fn().mockRejectedValue(new Error('disabled')),
  };
}

describe('expand/expandQuery (D38)', () => {
  beforeEach(() => {
    __clearExpansionCacheForTests();
  });

  it('returns empty alternatives when provider is disabled', async () => {
    const result = await expandQuery('how does auth work', disabledProvider());
    expect(result.original).toBe('how does auth work');
    expect(result.alternatives).toEqual([]);
  });

  it('returns empty alternatives for short queries (< 3 words)', async () => {
    const provider = mockProvider('["a", "b"]');
    const result = await expandQuery('auth flow', provider);
    expect(result.alternatives).toEqual([]);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('returns 2 alternatives from a mock provider', async () => {
    const provider = mockProvider('["authentication mechanism", "login process overview"]');
    const result = await expandQuery('how does auth work', provider);
    expect(result.original).toBe('how does auth work');
    expect(result.alternatives).toEqual([
      'authentication mechanism',
      'login process overview',
    ]);
  });

  it('parses JSON array from response with surrounding text', async () => {
    const provider = mockProvider(
      'Here are alternatives:\n["query one", "query two"]\nDone.'
    );
    const result = await expandQuery('how does auth work', provider);
    expect(result.alternatives).toHaveLength(2);
  });

  it('caches expansion results', async () => {
    const provider = mockProvider('["alt1", "alt2"]');
    await expandQuery('how does auth work', provider);
    await expandQuery('how does auth work', provider);

    // complete() should only be called once — second call uses cache
    expect(provider.complete).toHaveBeenCalledOnce();
  });

  it('returns empty alternatives on non-fatal provider error', async () => {
    const provider: LlmProvider = {
      name: 'broken',
      available: () => true,
      complete: vi.fn().mockRejectedValue(new Error('connection refused')),
    };
    const result = await expandQuery('how does auth work', provider);
    expect(result.alternatives).toEqual([]);
  });

  it('returns empty alternatives on malformed response', async () => {
    const provider = mockProvider('not valid json');
    const result = await expandQuery('how does auth work', provider);
    expect(result.alternatives).toEqual([]);
  });

  it('caps alternatives at 2 even if provider returns more', async () => {
    const provider = mockProvider('["a", "b", "c", "d"]');
    const result = await expandQuery('how does auth work', provider);
    expect(result.alternatives).toHaveLength(2);
  });
});
