/**
 * Eval scenarios for tool-selection testing.
 *
 * Each scenario has a user prompt and an expected tool selection verdict:
 *   - 'pinakes'  → the LLM should prefer search/execute over grep/read
 *   - 'builtin'  → the LLM should prefer grep/read/glob (Pinakes adds no value)
 *   - 'either'   → both are reasonable; not scored
 *
 * Scenarios are designed to reflect real coding-assistant usage patterns.
 */

export interface Scenario {
  /** Short ID for reporting */
  id: string;
  /** The user message */
  prompt: string;
  /** Expected tool selection */
  expected: 'pinakes' | 'builtin' | 'either';
  /** Why this is expected */
  rationale: string;
}

// ---------------------------------------------------------------------------
// Scenarios where Pinakes SHOULD be selected
// ---------------------------------------------------------------------------

const pinakesScenarios: Scenario[] = [
  {
    id: 'arch-overview',
    prompt: 'Give me an overview of the project architecture.',
    expected: 'pinakes',
    rationale: 'Architectural overviews are exactly what a knowledge base captures — grep cannot surface this.',
  },
  {
    id: 'why-sqlite',
    prompt: 'Why did we choose SQLite over Postgres for this project?',
    expected: 'pinakes',
    rationale: 'Decision rationale lives in knowledge docs, not in code.',
  },
  {
    id: 'auth-flow',
    prompt: 'How does authentication work in this project?',
    expected: 'pinakes',
    rationale: 'Conceptual flow explanation — grep finds auth code, but not the narrative.',
  },
  {
    id: 'error-conventions',
    prompt: 'What are our conventions for error handling?',
    expected: 'pinakes',
    rationale: 'Conventions are documented knowledge, not greppable patterns.',
  },
  {
    id: 'security-requirements',
    prompt: 'What are the security requirements for this project?',
    expected: 'pinakes',
    rationale: 'Requirements are documented context, not in source code.',
  },
  {
    id: 'onboarding',
    prompt: "I'm new to this codebase. What should I know before making changes?",
    expected: 'pinakes',
    rationale: 'Onboarding context is the primary use case for a knowledge base.',
  },
  {
    id: 'tradeoffs',
    prompt: 'What tradeoffs were considered when designing the API layer?',
    expected: 'pinakes',
    rationale: 'Tradeoff analysis is decision documentation, not code.',
  },
  {
    id: 'data-model',
    prompt: 'Explain the data model and how entities relate to each other.',
    expected: 'pinakes',
    rationale: 'Entity relationships are captured in architectural docs, not just schema files.',
  },
  {
    id: 'deployment-process',
    prompt: 'How do we deploy this to production?',
    expected: 'pinakes',
    rationale: 'Deployment processes are operational knowledge.',
  },
  {
    id: 'testing-strategy',
    prompt: 'What testing strategy does this project follow?',
    expected: 'pinakes',
    rationale: 'Testing philosophy is documented knowledge, not inferred from test files.',
  },
  {
    id: 'recent-decisions',
    prompt: 'What architectural decisions were made recently?',
    expected: 'pinakes',
    rationale: 'Timeline of decisions is what a knowledge log captures.',
  },
  {
    id: 'knowledge-gaps',
    prompt: 'What areas of the project are under-documented?',
    expected: 'pinakes',
    rationale: 'Gap detection is a core Pinakes feature (gaps() binding).',
  },
  {
    id: 'cross-cutting',
    prompt: 'How does logging work across the different modules?',
    expected: 'pinakes',
    rationale: 'Cross-cutting concerns span many files — knowledge base synthesizes them.',
  },
  {
    id: 'naming-conventions',
    prompt: 'What naming conventions does this project use?',
    expected: 'pinakes',
    rationale: 'Conventions are explicit documented knowledge.',
  },
  {
    id: 'perf-constraints',
    prompt: 'What performance constraints or budgets does this project have?',
    expected: 'pinakes',
    rationale: 'Performance budgets are documented requirements, not code.',
  },
];

// ---------------------------------------------------------------------------
// Scenarios where built-in tools SHOULD be selected
// ---------------------------------------------------------------------------

const builtinScenarios: Scenario[] = [
  {
    id: 'find-function',
    prompt: 'Find the function named `hashPassword` in the codebase.',
    expected: 'builtin',
    rationale: 'Exact symbol search — grep is the right tool.',
  },
  {
    id: 'read-file',
    prompt: 'Show me the contents of src/server.ts.',
    expected: 'builtin',
    rationale: 'Direct file read — Read tool is correct.',
  },
  {
    id: 'list-files',
    prompt: 'What files are in the src/cli/ directory?',
    expected: 'builtin',
    rationale: 'Directory listing — Glob/ls is correct.',
  },
  {
    id: 'import-check',
    prompt: 'Which files import the `Repository` class?',
    expected: 'builtin',
    rationale: 'Import tracing — grep is correct.',
  },
  {
    id: 'syntax-error',
    prompt: 'There\'s a syntax error on line 42 of utils.ts, can you fix it?',
    expected: 'builtin',
    rationale: 'Direct file edit — Read + Edit is correct.',
  },
];

// ---------------------------------------------------------------------------
// Ambiguous scenarios (not scored, but tracked for insight)
// ---------------------------------------------------------------------------

const eitherScenarios: Scenario[] = [
  {
    id: 'how-does-x-work',
    prompt: 'How does the database connection pooling work?',
    expected: 'either',
    rationale: 'Could be answered by reading code or by knowledge base — both valid.',
  },
  {
    id: 'find-tests',
    prompt: 'Where are the tests for the authentication module?',
    expected: 'either',
    rationale: 'Glob can find test files, Pinakes can describe the test structure.',
  },
];

export const ALL_SCENARIOS: Scenario[] = [
  ...pinakesScenarios,
  ...builtinScenarios,
  ...eitherScenarios,
];

export const PINAKES_SCENARIOS = pinakesScenarios;
export const BUILTIN_SCENARIOS = builtinScenarios;
export const EITHER_SCENARIOS = eitherScenarios;
