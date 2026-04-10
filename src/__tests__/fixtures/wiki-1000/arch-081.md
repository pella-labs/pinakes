# Shard Key Selection

Quick reference for choosing shard keys.

## Good Shard Keys

- High cardinality (many distinct values)
- Even distribution
- Commonly used in queries (avoids scatter-gather)
- Stable (doesn't change for a record)

## Bad Shard Keys

- Low cardinality (e.g., country code — a few shards get 80% of traffic)
- Monotonically increasing (e.g., auto-increment ID — all writes go to one shard)
- Frequently changing

## Examples

| Domain | Good Key | Why |
|---|---|---|
| Multi-tenant SaaS | tenant_id | Natural isolation, even if uneven |
| Social media | user_id | Most queries are user-scoped |
| IoT | device_id + time bucket | Spreads writes, enables time-range queries |
| E-commerce | order_id (hash) | Even distribution via hash |

## Compound Shard Keys

Use when a single key creates hot spots. E.g., `(tenant_id, created_month)` spreads a large tenant's data across monthly shards.

See [[database-sharding]], [[arch-041]].
