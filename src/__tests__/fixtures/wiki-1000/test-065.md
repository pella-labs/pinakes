
# Testing Timezone Handling

Timezone bugs are insidious. They appear only at certain times of day, during DST transitions, or for users in specific timezones.

## Fixing the Timezone in Tests

```typescript
beforeAll(() => {
  process.env.TZ = 'UTC';
});
```

## Cross-Timezone Testing

Test with multiple timezones to catch assumptions:

```typescript
const timezones = ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'Pacific/Auckland'];

timezones.forEach(tz => {
  it(`formats correctly in ${tz}`, () => {
    const date = new Date('2025-06-15T12:00:00Z');
    const formatted = formatDateInTimezone(date, tz);
    expect(formatted).toMatchSnapshot();
  });
});
```

## DST Transition Tests

Test dates around daylight saving time transitions:

- The hour that doesn't exist (spring forward)
- The hour that occurs twice (fall back)
- Scheduling a recurring event across a DST boundary

## Date Arithmetic

Adding "one day" to a date should always produce the next calendar day, even across DST transitions. Test this explicitly.

## Storage and Display

Store dates in UTC. Convert to local timezone only for display. Test both the storage format and the display format.
