import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureAgentInstructions } from '../../paths.js';

describe('ensureAgentInstructions', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pinakes-agent-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('creates both CLAUDE.md and AGENTS.md when neither exists', () => {
    ensureAgentInstructions(tmp);

    expect(existsSync(join(tmp, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(tmp, 'AGENTS.md'))).toBe(true);

    const claude = readFileSync(join(tmp, 'CLAUDE.md'), 'utf-8');
    const agents = readFileSync(join(tmp, 'AGENTS.md'), 'utf-8');
    expect(claude).toContain('knowledge_search');
    expect(agents).toContain('knowledge_search');
  });

  it('appends to existing CLAUDE.md without clobbering', () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), '# My Project\n\nExisting content.\n', 'utf-8');

    ensureAgentInstructions(tmp);

    const content = readFileSync(join(tmp, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('# My Project');
    expect(content).toContain('Existing content.');
    expect(content).toContain('knowledge_search');
  });

  it('appends to existing AGENTS.md without clobbering', () => {
    writeFileSync(join(tmp, 'AGENTS.md'), '# Agents\n', 'utf-8');

    ensureAgentInstructions(tmp);

    const content = readFileSync(join(tmp, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('# Agents');
    expect(content).toContain('knowledge_search');
  });

  it('is idempotent — does not duplicate on re-run', () => {
    ensureAgentInstructions(tmp);
    ensureAgentInstructions(tmp);

    const content = readFileSync(join(tmp, 'CLAUDE.md'), 'utf-8');
    const markerCount = content.split('pinakes-instructions').length - 1;
    expect(markerCount).toBe(1);
  });
});
