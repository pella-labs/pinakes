/**
 * Simulated built-in tool schemas that compete with Pinakes for selection.
 *
 * These represent the tools an LLM coding assistant typically has available
 * (Read, Grep, Glob, Agent/Explore). We define them as Anthropic API tool
 * schemas so the eval can present them alongside Pinakes tools.
 */

import type Anthropic from '@anthropic-ai/sdk';

type Tool = Anthropic.Messages.Tool;

export const COMPETITOR_TOOLS: Tool[] = [
  {
    name: 'Read',
    description:
      'Read a file from the local filesystem. Use this to read source code, ' +
      'configuration files, documentation, or any text file in the project.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'The absolute path to the file to read.',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'Grep',
    description:
      'Search file contents using regex. Find function definitions, imports, ' +
      'string literals, error messages, or any text pattern across the codebase.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'The regex pattern to search for.',
        },
        path: {
          type: 'string',
          description: 'Directory or file to search in. Defaults to project root.',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'Glob',
    description:
      'Find files by name pattern. Use glob patterns like "**/*.ts" or ' +
      '"src/cli/*.ts" to locate files in the project.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match files.',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'Agent',
    description:
      'Launch a sub-agent to explore the codebase. Use for broad codebase ' +
      'exploration, finding files, searching code, or answering questions ' +
      'about how the codebase works.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'The task for the agent to perform.',
        },
      },
      required: ['prompt'],
    },
  },
];
