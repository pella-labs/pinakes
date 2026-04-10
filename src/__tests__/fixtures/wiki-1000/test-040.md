# Testing File System Operations

File system tests need careful setup and teardown to avoid polluting the test environment.

## Temporary Directories

```typescript
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true });
});

it('writes config file', () => {
  writeConfig(tempDir, { port: 3000 });
  const content = readFileSync(join(tempDir, 'config.json'), 'utf-8');
  expect(JSON.parse(content)).toEqual({ port: 3000 });
});
```

## Testing File Watching

File watcher tests are inherently timing-sensitive. Use long timeouts and explicit event waits:

```typescript
it('detects new files', async () => {
  const watcher = new FileWatcher(tempDir);
  const detected = new Promise<string>(resolve => {
    watcher.on('add', resolve);
  });

  writeFileSync(join(tempDir, 'new.txt'), 'hello');

  const path = await detected;
  expect(path).toContain('new.txt');
});
```

## Permission Testing

Test behavior when files are read-only, directories are missing, or disk is full. These edge cases cause production failures.

## Cross-Platform Concerns

File paths, line endings, and permissions differ across operating systems. If your code must work cross-platform, test on all target platforms or use CI matrix builds.
