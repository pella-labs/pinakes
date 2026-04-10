---
confidence: ambiguous
---
# Event Versioning

## The Problem

Event schemas change over time. Adding fields, renaming fields, changing types. But old events in the store still have the old schema.

## Strategies

### Weak Schema
Use JSON with optional fields. Old events have fewer fields; consumers handle missing fields with defaults. Works for simple changes.

### Upcasting
Transform old events to the current schema on read:

```typescript
function upcastOrderCreated(event: any): OrderCreatedV3 {
  if (event.version === 1) {
    return { ...event, version: 3, currency: 'USD', source: 'unknown' };
  }
  if (event.version === 2) {
    return { ...event, version: 3, source: 'unknown' };
  }
  return event;
}
```

### Copy-and-Transform
Create a new event stream with all events migrated to the latest schema. The old stream is archived.

## Best Practices

- Always include a version number in events
- Only add fields (backward compatible)
- Use upcasting for simple migrations
- Reserve copy-and-transform for major overhauls

See [[arch-005]], [[arch-003]], [[arch-024]].
