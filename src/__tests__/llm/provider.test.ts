import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createLlmProvider,
  type McpServerLike,
  _DisabledProvider,
} from '../../llm/provider.js';

describe('llm/provider (D36)', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars to isolate tests
    delete process.env['PINAKES_OLLAMA_URL'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('prefers MCP sampling when client declares capability', () => {
    const server: McpServerLike = {
      getClientCapabilities: () => ({ sampling: {} }),
      createMessage: vi.fn().mockResolvedValue({
        content: { type: 'text', text: 'expanded query' },
      }),
    };

    const provider = createLlmProvider(server);
    expect(provider.name).toBe('mcp-sampling');
    expect(provider.available()).toBe(true);
  });

  it('falls back to Ollama when PINAKES_OLLAMA_URL is set', () => {
    process.env['PINAKES_OLLAMA_URL'] = 'http://localhost:11434';

    const provider = createLlmProvider();
    expect(provider.name).toBe('ollama');
    expect(provider.available()).toBe(true);
  });

  it('falls back to Anthropic API when ANTHROPIC_API_KEY is set', () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const provider = createLlmProvider();
    expect(provider.name).toBe('anthropic-api');
    expect(provider.available()).toBe(true);
  });

  it('falls back to OpenAI API when OPENAI_API_KEY is set', () => {
    process.env['OPENAI_API_KEY'] = 'test-key';

    const provider = createLlmProvider();
    expect(provider.name).toBe('openai-api');
    expect(provider.available()).toBe(true);
  });

  it('MCP sampling provider calls createMessage correctly', async () => {
    const createMessage = vi.fn().mockResolvedValue({
      content: { type: 'text', text: 'result text' },
    });
    const server: McpServerLike = {
      getClientCapabilities: () => ({ sampling: {} }),
      createMessage,
    };

    const provider = createLlmProvider(server);
    const result = await provider.complete({
      system: 'You are a helper.',
      prompt: 'Expand this query',
      maxTokens: 100,
    });

    expect(result).toBe('result text');
    expect(createMessage).toHaveBeenCalledOnce();
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: { type: 'text', text: 'Expand this query' } }],
        systemPrompt: 'You are a helper.',
        maxTokens: 100,
      })
    );
  });

  it('disabled provider returns available=false', () => {
    const provider = new _DisabledProvider();
    expect(provider.available()).toBe(false);
    expect(provider.name).toBe('disabled');
  });

  it('disabled provider throws on complete()', async () => {
    const provider = new _DisabledProvider();
    await expect(
      provider.complete({ system: '', prompt: '', maxTokens: 100 })
    ).rejects.toThrow(/No LLM provider available/);
  });

  it('respects priority: MCP > Ollama > API key', () => {
    process.env['PINAKES_OLLAMA_URL'] = 'http://localhost:11434';
    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    // With MCP server that has sampling → MCP wins
    const server: McpServerLike = {
      getClientCapabilities: () => ({ sampling: {} }),
      createMessage: vi.fn(),
    };
    expect(createLlmProvider(server).name).toBe('mcp-sampling');

    // Without MCP → Ollama wins over API key
    expect(createLlmProvider().name).toBe('ollama');

    // Remove Ollama → API key wins
    delete process.env['PINAKES_OLLAMA_URL'];
    expect(createLlmProvider().name).toBe('anthropic-api');
  });
});
