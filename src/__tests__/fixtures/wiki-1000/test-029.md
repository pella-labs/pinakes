# Testing CLI Applications

Command-line applications need testing too. The interface is text-based, but the principles are the same as UI testing.

## Approaches

### Process Spawning

Run the CLI as a subprocess and capture stdout/stderr:

```typescript
import { execSync } from 'child_process';

it('prints help text', () => {
  const output = execSync('node dist/cli.js --help').toString();
  expect(output).toContain('Usage:');
  expect(output).toContain('--verbose');
});

it('exits with code 1 on error', () => {
  expect(() => {
    execSync('node dist/cli.js --invalid-flag');
  }).toThrow();
});
```

### Direct Function Testing

Test the CLI handler functions directly, bypassing the argument parser:

```typescript
it('processes input file', async () => {
  const result = await handleProcess({
    input: 'fixtures/sample.txt',
    format: 'json',
  });
  expect(result.items).toHaveLength(3);
});
```

### Interactive CLI Testing

For interactive prompts, use libraries like **mock-stdin** or test the prompt logic separately from the I/O layer.

## Exit Codes

Test that your CLI returns correct exit codes. Zero means success. Non-zero means specific error types. Document and test each code.
