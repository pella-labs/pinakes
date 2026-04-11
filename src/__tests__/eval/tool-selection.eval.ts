/**
 * Tool-selection eval for Pinakes MCP.
 *
 * Measures whether Claude selects Pinakes tools (search/execute) over built-in
 * tools (Grep/Read/Glob/Agent) for scenarios where Pinakes should be preferred.
 *
 * Uses `@anthropic-ai/claude-agent-sdk` query() — no separate API key needed,
 * it authenticates via existing Claude Code credentials.
 *
 * Run:
 *   pnpm exec tsx src/__tests__/eval/tool-selection.eval.ts
 *
 * The eval:
 *   1. Starts a headless Claude Code session with Pinakes configured as MCP server
 *   2. For each scenario, sends a prompt with maxTurns=1
 *   3. Inspects which tool Claude calls first
 *   4. Reports selection rates for pinakes-should vs builtin-should scenarios
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { resolve } from 'node:path';
import { ALL_SCENARIOS, PINAKES_SCENARIOS, BUILTIN_SCENARIOS, type Scenario } from './scenarios.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Path to a fixture project that has wiki content for Pinakes to index. */
const FIXTURE_PROJECT = resolve(import.meta.dirname, '../fixtures');

/** Use wiki-100 for a more realistic knowledge base (100 files, ~4600 lines). */
const WIKI_PATH = resolve(FIXTURE_PROJECT, 'wiki-100');

/** The MCP server command — run our Pinakes server against the fixture wiki. */
const PINAKES_SERVER_CMD = 'tsx';
const PINAKES_SERVER_ARGS = [
  resolve(import.meta.dirname, '../../server.ts'),
  '--wiki-path', WIKI_PATH,
];

const PINAKES_TOOL_NAMES = new Set(['search', 'execute']);

/**
 * Tools that represent the "built-in" Claude Code tools.
 * MCP tool names are prefixed with the server name, e.g. 'mcp__pinakes__search'.
 * Built-in tools are just 'Grep', 'Read', 'Glob', 'Agent', etc.
 */
const BUILTIN_TOOL_NAMES = new Set([
  'Read', 'Grep', 'Glob', 'Agent', 'Bash', 'Edit', 'Write',
  'WebSearch', 'WebFetch',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalResult {
  scenario: Scenario;
  firstToolCalled: string | null;
  allToolsCalled: string[];
  selectedPinakes: boolean;
  selectedBuiltin: boolean;
  correct: boolean | null; // null for 'either' scenarios
  durationMs: number;
  cost: number;
  error?: string;
}

interface EvalSummary {
  total: number;
  pinakesScenarios: { total: number; correct: number; rate: number };
  builtinScenarios: { total: number; correct: number; rate: number };
  results: EvalResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPinakesTool(toolName: string): boolean {
  // MCP tools appear as 'mcp__<server>__<tool>' or just the raw name
  if (PINAKES_TOOL_NAMES.has(toolName)) return true;
  if (toolName.includes('pinakes') || toolName.includes('kg-mcp')) return true;
  // Match any mcp__ prefixed search/execute
  if (/^mcp__.*__(search|execute)$/.test(toolName)) return true;
  return false;
}

function isBuiltinTool(toolName: string): boolean {
  return BUILTIN_TOOL_NAMES.has(toolName);
}

/**
 * Extract the first tool call from the query messages.
 */
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
// Run one scenario
// ---------------------------------------------------------------------------

async function runScenario(scenario: Scenario): Promise<EvalResult> {
  const t0 = Date.now();
  const collected: SDKMessage[] = [];
  let cost = 0;

  try {
    const abortController = new AbortController();
    // 120s timeout per scenario (maxTurns=3 means actual tool execution)
    const timeout = setTimeout(() => abortController.abort(), 120_000);

    const result = query({
      prompt: scenario.prompt,
      options: {
        abortController,
        model: 'claude-sonnet-4-6',
        maxTurns: 3,
        cwd: FIXTURE_PROJECT,
        permissionMode: 'bypassPermissions' as const,
        systemPrompt: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
        },
        mcpServers: {
          pinakes: {
            command: PINAKES_SERVER_CMD,
            args: PINAKES_SERVER_ARGS,
          },
        },
      },
    });

    for await (const message of result) {
      collected.push(message);
      // Extract cost from result messages
      if (message.type === 'result') {
        cost = (message as { total_cost_usd?: number }).total_cost_usd ?? 0;
      }
    }

    clearTimeout(timeout);
  } catch (err) {
    // error_max_turns is expected — we set maxTurns=1 on purpose.
    // The tool calls are still in the collected messages.
    const errMsg = err instanceof Error ? err.message : String(err);
    if (!errMsg.includes('max') && !errMsg.includes('turns')) {
      const durationMs = Date.now() - t0;
      return {
        scenario,
        firstToolCalled: null,
        allToolsCalled: [],
        selectedPinakes: false,
        selectedBuiltin: false,
        correct: null,
        durationMs,
        cost,
        error: errMsg,
      };
    }
  }

  const toolsCalled = extractToolCalls(collected);
  const firstTool = toolsCalled[0] ?? null;
  // Check if any (not just first) tool call was Pinakes — MCP tools require
  // ToolSearch first, so the first call might be ToolSearch, not the actual tool.
  const usedPinakes = toolsCalled.some(t => isPinakesTool(t));
  const usedBuiltin = toolsCalled.some(t => isBuiltinTool(t));

  let correct: boolean | null = null;
  if (scenario.expected === 'pinakes') correct = usedPinakes;
  else if (scenario.expected === 'builtin') correct = usedBuiltin;
  // 'either' → null (not scored)

  return {
    scenario,
    firstToolCalled: firstTool,
    allToolsCalled: toolsCalled,
    selectedPinakes: usedPinakes,
    selectedBuiltin: usedBuiltin,
    correct,
    durationMs: Date.now() - t0,
    cost,
  };
}

// ---------------------------------------------------------------------------
// Run all scenarios and report
// ---------------------------------------------------------------------------

async function runEval(scenarios?: Scenario[]): Promise<EvalSummary> {
  const toRun = scenarios ?? ALL_SCENARIOS;
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  Pinakes Tool-Selection Eval — ${toRun.length} scenarios`);
  console.log(`${'='.repeat(70)}\n`);

  const results: EvalResult[] = [];

  for (const scenario of toRun) {
    process.stdout.write(`  [${scenario.id}] "${scenario.prompt.slice(0, 60)}..." `);
    const result = await runScenario(scenario);
    results.push(result);

    const icon = result.error ? '!' : result.correct === true ? '+' : result.correct === false ? '-' : '~';
    const tools = result.allToolsCalled.length > 0
      ? result.allToolsCalled.join(' → ')
      : '(none)';
    console.log(
      `[${icon}] ${tools} (${result.durationMs}ms, $${result.cost.toFixed(4)})`
    );
  }

  // Compute summary
  const pinakesResults = results.filter(r => r.scenario.expected === 'pinakes');
  const builtinResults = results.filter(r => r.scenario.expected === 'builtin');

  const pinakesCorrect = pinakesResults.filter(r => r.correct === true).length;
  const builtinCorrect = builtinResults.filter(r => r.correct === true).length;

  const summary: EvalSummary = {
    total: results.length,
    pinakesScenarios: {
      total: pinakesResults.length,
      correct: pinakesCorrect,
      rate: pinakesResults.length > 0 ? pinakesCorrect / pinakesResults.length : 0,
    },
    builtinScenarios: {
      total: builtinResults.length,
      correct: builtinCorrect,
      rate: builtinResults.length > 0 ? builtinCorrect / builtinResults.length : 0,
    },
    results,
  };

  // Print report
  console.log(`\n${'='.repeat(70)}`);
  console.log('  RESULTS');
  console.log(`${'='.repeat(70)}`);
  console.log();
  console.log(`  Pinakes-expected scenarios: ${pinakesCorrect}/${pinakesResults.length} correct (${(summary.pinakesScenarios.rate * 100).toFixed(0)}%)`);
  console.log(`  Builtin-expected scenarios: ${builtinCorrect}/${builtinResults.length} correct (${(summary.builtinScenarios.rate * 100).toFixed(0)}%)`);
  console.log();

  // Detail table for failures
  const failures = results.filter(r => r.correct === false);
  if (failures.length > 0) {
    console.log('  FAILURES:');
    for (const f of failures) {
      console.log(`    [${f.scenario.id}] expected=${f.scenario.expected} got=${f.firstToolCalled}`);
      console.log(`      prompt: "${f.scenario.prompt}"`);
      console.log(`      rationale: ${f.scenario.rationale}`);
    }
  }

  const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
  console.log(`\n  Total cost: $${totalCost.toFixed(4)}`);
  console.log(`  Total time: ${results.reduce((sum, r) => sum + r.durationMs, 0)}ms`);
  console.log();

  return summary;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const subset = args.includes('--pinakes-only')
  ? PINAKES_SCENARIOS
  : args.includes('--builtin-only')
    ? BUILTIN_SCENARIOS
    : undefined;

runEval(subset).then(summary => {
  // Exit with non-zero if pinakes selection rate is below threshold
  const threshold = 0.7; // 70% target
  if (summary.pinakesScenarios.rate < threshold) {
    console.error(
      `  FAIL: Pinakes selection rate ${(summary.pinakesScenarios.rate * 100).toFixed(0)}% < ${threshold * 100}% threshold`
    );
    process.exit(1);
  }
  console.log(`  PASS: Pinakes selection rate ${(summary.pinakesScenarios.rate * 100).toFixed(0)}% >= ${threshold * 100}% threshold`);
}).catch(err => {
  console.error('Eval failed:', err);
  process.exit(1);
});
