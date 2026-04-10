
# Testing CLI Output Formatting

CLI tools communicate through formatted text. Testing the output ensures usability.

## Table Output

```typescript
it('formats data as table', () => {
  const data = [
    { name: 'Alice', role: 'admin' },
    { name: 'Bob', role: 'viewer' },
  ];

  const output = formatTable(data);
  expect(output).toContain('NAME');
  expect(output).toContain('ROLE');
  expect(output).toContain('Alice');
  expect(output).toContain('admin');
});
```

## Color and Styling

Test that ANSI codes are applied correctly and can be disabled:

```typescript
it('adds color codes', () => {
  const output = colorize('Error: not found', 'red');
  expect(output).toContain('\x1b[31m');
});

it('strips colors when NO_COLOR is set', () => {
  process.env.NO_COLOR = '1';
  const output = colorize('Error: not found', 'red');
  expect(output).not.toContain('\x1b[');
});
```

## Progress Indicators

Test that progress bars or spinners produce expected output sequences.

## Width Handling

Test that output respects terminal width:

```typescript
it('wraps long lines at terminal width', () => {
  const output = formatWithWrapping(longText, { width: 80 });
  const lines = output.split('\n');
  lines.forEach(line => {
    expect(stripAnsi(line).length).toBeLessThanOrEqual(80);
  });
});
```

## JSON Output Mode

Many CLI tools support `--json` output. Test that the JSON is valid and complete:

```typescript
it('outputs valid JSON', () => {
  const output = runCli(['--json', 'status']);
  expect(() => JSON.parse(output)).not.toThrow();
});
```
