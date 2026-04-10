# Distributed Tracing Patterns

## Trace Anatomy

A **trace** represents an end-to-end request. It consists of **spans**, each representing a unit of work. Spans form a tree: the root span is the entry point, child spans are downstream calls.

## Span Attributes

Enrich spans with business context, not just technical details:

- `user.id`: which user triggered the request
- `order.id`: which business entity is involved
- `feature.flag`: which experiment variant is active
- `db.statement`: the SQL query (sanitized)

## Sampling Strategies

### Head-Based Sampling

Decide at the trace root whether to sample. Simple and efficient, but may miss interesting traces.

### Tail-Based Sampling

Collect all spans, then decide after the trace completes. This lets you keep all error traces and slow traces while dropping routine ones.

- Keep 100% of error traces
- Keep 100% of traces > p99 latency
- Sample 1% of successful, fast traces

### Adaptive Sampling

Dynamically adjust the sampling rate based on traffic volume to maintain a target traces-per-second.

## Common Pitfalls

- Not propagating context through async boundaries
- Excessive span creation (one span per loop iteration)
- Missing spans in message queue consumers (broken trace continuity)
- Not sampling — sending 100% of traces to the backend is prohibitively expensive at scale

See [[perf-017]] for OTel setup and [[perf-019]] for structured logging.
