# Memory-Efficient Data Structures

## Bloom Filters

A **Bloom filter** answers "is this element in the set?" with some false-positive probability but no false negatives. Uses far less memory than storing the actual set.

Use cases:
- Check if a URL has been crawled before
- Deduplicate events in a stream
- Cache miss avoidance (check Bloom filter before hitting cache)

## HyperLogLog

Estimates the cardinality (count of distinct elements) of a set using ~12KB regardless of set size. Redis implements this natively.

```bash
PFADD unique_visitors "user_123"
PFADD unique_visitors "user_456"
PFCOUNT unique_visitors  # returns 2 (approximately)
```

## Count-Min Sketch

Estimates the frequency of elements in a stream with bounded overcount. Useful for top-K queries on high-cardinality data.

## Trie / Radix Tree

Compresses string storage by sharing common prefixes. Useful for routing tables, autocomplete, and IP lookup.

## When to Use Probabilistic Data Structures

When exact answers are not necessary and the dataset is too large for exact data structures. Common in:

- Real-time analytics
- Network monitoring
- Stream processing
- Cache management

See [[perf-062]] for Redis memory optimization.
