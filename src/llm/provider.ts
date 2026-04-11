import { execFile } from 'node:child_process';
import { logger } from '../observability/logger.js';

/**
 * LLM provider factory (D36).
 *
 * Tiered cascade for lightweight completions (query expansion,
 * contradiction detection) without requiring the user to set up
 * a separate API key:
 *
 *   1. MCP Sampling — if client declares capability (future-proof)
 *   2. Ollama — local HTTP, free, ~100ms
 *   3. API key — ANTHROPIC_API_KEY or OPENAI_API_KEY via fetch()
 *   4. `claude -p` subprocess — user's Claude subscription (~2-5s)
 *   5. `codex exec` subprocess — user's ChatGPT subscription (~2-5s)
 *   6. Disabled — graceful degradation
 *
 * No new dependencies. Uses fetch() for HTTP, child_process for CLI.
 */

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface LlmProvider {
  readonly name: string;
  available(): boolean;
  complete(opts: { system: string; prompt: string; maxTokens: number }): Promise<string>;
}

/**
 * Server type — minimal shape we need from the MCP SDK's Server class.
 * Using a structural type to avoid importing the SDK at the module level.
 */
export interface McpServerLike {
  getClientCapabilities?(): { sampling?: Record<string, unknown> } | undefined;
  createMessage?(params: {
    messages: Array<{ role: string; content: { type: string; text: string } }>;
    systemPrompt?: string;
    maxTokens: number;
    modelPreferences?: { hints?: Array<{ name: string }>; costPriority?: number };
  }): Promise<{ content: { type: string; text?: string } }>;
}

/**
 * Create the best available LLM provider by probing the environment.
 * First available provider in the cascade wins.
 */
export function createLlmProvider(mcpServer?: McpServerLike): LlmProvider {
  // 1. MCP Sampling
  if (mcpServer) {
    const sampling = mcpServer.getClientCapabilities?.()?.sampling;
    if (sampling && mcpServer.createMessage) {
      return new McpSamplingProvider(mcpServer);
    }
  }

  // 2. Ollama
  const ollamaUrl = process.env['KG_OLLAMA_URL'];
  if (ollamaUrl) {
    return new OllamaProvider(ollamaUrl);
  }

  // 3. API key (Anthropic or OpenAI)
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  if (anthropicKey) {
    return new AnthropicApiProvider(anthropicKey);
  }
  const openaiKey = process.env['OPENAI_API_KEY'];
  if (openaiKey) {
    return new OpenAiApiProvider(openaiKey);
  }

  // 4. claude -p subprocess
  if (whichSync('claude')) {
    return new ClaudeSubprocessProvider();
  }

  // 5. codex exec subprocess
  if (whichSync('codex')) {
    return new CodexSubprocessProvider();
  }

  // 6. Disabled
  return new DisabledProvider();
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

class McpSamplingProvider implements LlmProvider {
  readonly name = 'mcp-sampling';
  constructor(private readonly server: McpServerLike) {}

  available(): boolean {
    return true;
  }

  async complete(opts: { system: string; prompt: string; maxTokens: number }): Promise<string> {
    const result = await this.server.createMessage!({
      messages: [{ role: 'user', content: { type: 'text', text: opts.prompt } }],
      systemPrompt: opts.system,
      maxTokens: opts.maxTokens,
      modelPreferences: {
        hints: [{ name: 'haiku' }],
        costPriority: 0.8,
      },
    });
    return result.content.text ?? '';
  }
}

class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';
  constructor(private readonly baseUrl: string) {}

  available(): boolean {
    return true;
  }

  async complete(opts: { system: string; prompt: string; maxTokens: number }): Promise<string> {
    const model = process.env['KG_OLLAMA_MODEL'] ?? 'llama3.2';
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/chat`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.prompt },
        ],
        stream: false,
        options: { num_predict: opts.maxTokens },
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? '';
  }
}

class AnthropicApiProvider implements LlmProvider {
  readonly name = 'anthropic-api';
  constructor(private readonly apiKey: string) {}

  available(): boolean {
    return true;
  }

  async complete(opts: { system: string; prompt: string; maxTokens: number }): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [{ role: 'user', content: opts.prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    return data.content?.[0]?.text ?? '';
  }
}

class OpenAiApiProvider implements LlmProvider {
  readonly name = 'openai-api';
  constructor(private readonly apiKey: string) {}

  available(): boolean {
    return true;
  }

  async complete(opts: { system: string; prompt: string; maxTokens: number }): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: opts.maxTokens,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }
}

class ClaudeSubprocessProvider implements LlmProvider {
  readonly name = 'claude-subprocess';

  available(): boolean {
    return true;
  }

  async complete(opts: { system: string; prompt: string; maxTokens: number }): Promise<string> {
    return runSubprocess('claude', [
      '-p', opts.prompt,
      '--bare',
      '--tools', '',
      '--model', 'haiku',
      '--system-prompt', opts.system,
      '--output-format', 'text',
      '--max-tokens', String(opts.maxTokens),
    ]);
  }
}

class CodexSubprocessProvider implements LlmProvider {
  readonly name = 'codex-subprocess';

  available(): boolean {
    return true;
  }

  async complete(opts: { system: string; prompt: string; maxTokens: number }): Promise<string> {
    return runSubprocess('codex', [
      'exec',
      `${opts.system}\n\n${opts.prompt}`,
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox', 'read-only',
    ]);
  }
}

class DisabledProvider implements LlmProvider {
  readonly name = 'disabled';

  available(): boolean {
    return false;
  }

  async complete(): Promise<string> {
    throw new Error(
      'No LLM provider available. Set KG_OLLAMA_URL, ANTHROPIC_API_KEY, or ' +
        'OPENAI_API_KEY, or install claude/codex CLI.'
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a binary exists in PATH (synchronous, cached). */
const binaryCache = new Map<string, boolean>();

function whichSync(name: string): boolean {
  const cached = binaryCache.get(name);
  if (cached !== undefined) return cached;

  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    execFileSync('which', [name], { stdio: 'ignore' });
    binaryCache.set(name, true);
    return true;
  } catch {
    binaryCache.set(name, false);
    return false;
  }
}

/** Run a CLI tool and return its stdout. Timeout: 30s. */
function runSubprocess(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        logger.warn({ err, cmd, stderr: stderr?.slice(0, 200) }, 'subprocess LLM call failed');
        reject(new Error(`${cmd} failed: ${err.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

// Export for testing
export { DisabledProvider as _DisabledProvider };
export { whichSync as _whichSync };
