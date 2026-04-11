/**
 * Run all eval variants in parallel by spawning separate processes.
 * Each variant modifies the server config via env vars that serve.ts reads.
 *
 * Usage: pnpm exec tsx src/__tests__/eval/run-variants.ts
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { resolve } from 'node:path';
import { PINAKES_SCENARIOS, type Scenario } from './scenarios.js';

const FIXTURE_PROJECT = resolve(import.meta.dirname, '../fixtures');
const WIKI_PATH = resolve(FIXTURE_PROJECT, 'wiki-100');
const SERVER_TS = resolve(import.meta.dirname, '../../server.ts');

// ---------------------------------------------------------------------------
// Variant definitions — each tweaks what the eval server looks like
// ---------------------------------------------------------------------------

interface Variant {
  id: string;
  description: string;
  /** MCP server name in the eval config */
  serverName: string;
  /** Extra env vars passed to the MCP server process */
  serverEnv: Record<string, string>;
}

const VARIANTS: Variant[] = [
  {
    id: 'default',
    description: 'Default config (project-docs + knowledge_search/knowledge_query + aggressive instructions)',
    serverName: 'project-docs',
    serverEnv: {},
  },
  {
    id: 'legacy-names',
    description: 'Legacy tool/server names (pinakes + search/execute)',
    serverName: 'pinakes',
    serverEnv: {
      PINAKES_SERVER_NAME: 'pinakes',
      PINAKES_TOOL_SEARCH_NAME: 'search',
      PINAKES_TOOL_EXECUTE_NAME: 'execute',
    },
  },
  {
    id: 'custom-server-name',
    description: 'Custom server name test',
    serverName: 'project-docs',
    serverEnv: {
      PINAKES_EVAL_INSTRUCTIONS: 'aggressive',
      PINAKES_EVAL_TOOL_NAMES: 'knowledge',
    },
  },
];

// ---------------------------------------------------------------------------
// Tool detection
// ---------------------------------------------------------------------------

const PINAKES_PATTERNS = [
  'search', 'execute', 'knowledge_search', 'knowledge_query',
  'pinakes', 'kg-mcp', 'project-docs',
];

function isPinakesTool(toolName: string): boolean {
  for (const p of PINAKES_PATTERNS) {
    if (toolName.includes(p)) return true;
  }
  return false;
}

function extractToolCalls(messages: SDKMessage[]): string[] {
  const tools: string[] = [];
  for (const msg of messages) {
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use') {
          tools.push(block.name);
        }
      }
    }
  }
  return tools;
}

// ---------------------------------------------------------------------------
// Run one scenario for one variant
// ---------------------------------------------------------------------------

async function runScenario(
  variant: Variant,
  scenario: Scenario
): Promise<{ tools: string[]; usedPinakes: boolean; cost: number; ms: number; error?: string }> {
  const t0 = Date.now();
  const collected: SDKMessage[] = [];
  let cost = 0;

  try {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 120_000);

    const result = query({
      prompt: scenario.prompt,
      options: {
        abortController,
        model: 'claude-sonnet-4-6',
        maxTurns: 3,
        cwd: FIXTURE_PROJECT,
        permissionMode: 'bypassPermissions' as const,
        systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const },
        mcpServers: {
          [variant.serverName]: {
            command: 'tsx',
            args: [SERVER_TS, '--wiki-path', WIKI_PATH],
            env: { ...process.env, ...variant.serverEnv },
          },
        },
      },
    });

    for await (const message of result) {
      collected.push(message);
      if (message.type === 'result') {
        cost = (message as { total_cost_usd?: number }).total_cost_usd ?? 0;
      }
    }
    clearTimeout(timeout);
  } catch {
    // error_max_turns is expected
  }

  const tools = extractToolCalls(collected);
  const usedPinakes = tools.some(t => isPinakesTool(t));
  return { tools, usedPinakes, cost, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
// Run one full variant (all scenarios)
// ---------------------------------------------------------------------------

async function runVariant(variant: Variant): Promise<{
  id: string;
  correct: number;
  total: number;
  rate: number;
  cost: number;
  details: string[];
}> {
  const details: string[] = [];
  let correct = 0;
  let totalCost = 0;

  for (const scenario of PINAKES_SCENARIOS) {
    process.stdout.write(`  ${scenario.id}... `);
    const r = await runScenario(variant, scenario);
    totalCost += r.cost;
    const icon = r.usedPinakes ? '+' : '-';
    const toolsStr = r.tools.length > 0 ? r.tools.join(' → ') : '(none)';
    const line = `[${icon}] ${toolsStr} (${r.ms}ms, $${r.cost.toFixed(4)})`;
    details.push(`  [${icon}] ${scenario.id}: ${toolsStr} (${r.ms}ms)`);
    console.log(line);
    if (r.usedPinakes) correct++;
  }

  return {
    id: variant.id,
    correct,
    total: PINAKES_SCENARIOS.length,
    rate: correct / PINAKES_SCENARIOS.length,
    cost: totalCost,
    details,
  };
}

// ---------------------------------------------------------------------------
// Main: run selected variants
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const selectedIds = args.length > 0 ? args : VARIANTS.map(v => v.id);
  const toRun = VARIANTS.filter(v => selectedIds.includes(v.id));

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  Pinakes Tool-Selection Eval — ${toRun.length} variants × ${PINAKES_SCENARIOS.length} scenarios`);
  console.log(`${'='.repeat(70)}\n`);

  // Run variants sequentially (each takes ~7 min, parallel would overload)
  const results = [];
  for (const variant of toRun) {
    console.log(`\n--- Variant: ${variant.id} (${variant.description}) ---\n`);
    const result = await runVariant(variant);
    results.push(result);

    for (const d of result.details) console.log(d);
    console.log(`\n  → ${result.correct}/${result.total} = ${(result.rate * 100).toFixed(0)}% ($${result.cost.toFixed(2)})\n`);
  }

  // Summary table
  console.log(`\n${'='.repeat(70)}`);
  console.log('  COMPARISON');
  console.log(`${'='.repeat(70)}`);
  console.log();
  console.log('  Variant                   Rate    Correct  Cost');
  console.log('  ' + '-'.repeat(55));
  for (const r of results) {
    const rate = `${(r.rate * 100).toFixed(0)}%`.padStart(4);
    const correct = `${r.correct}/${r.total}`.padStart(7);
    const cost = `$${r.cost.toFixed(2)}`.padStart(7);
    console.log(`  ${r.id.padEnd(26)} ${rate}  ${correct}  ${cost}`);
  }
  console.log();
}

main().catch(err => {
  console.error('Eval failed:', err);
  process.exit(1);
});
