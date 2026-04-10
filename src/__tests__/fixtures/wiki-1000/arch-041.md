# Data Partitioning Strategies

## Horizontal Partitioning (Sharding)

Split rows across multiple databases/tables. Each shard holds a subset of the data.

### Shard Key Selection

The shard key determines which shard a row goes to. Choose poorly and you get hot spots.

- **User ID** — even distribution if users are equally active (they're not)
- **Tenant ID** — natural for multi-tenant SaaS
- **Geographic region** — good for data locality
- **Compound key** — combine multiple attributes

## Vertical Partitioning

Split columns. Put frequently accessed columns in one table, rarely used columns in another.

## Functional Partitioning

Split by function: orders go to one DB, analytics to another, user profiles to a third.

## Rebalancing

When shards get uneven, you need to rebalance. Options:
- **Hash-based** — consistent hashing minimizes data movement
- **Range-based** — split hot ranges
- **Directory-based** — a lookup table maps keys to shards

See [[database-sharding]], [[arch-039]].
