# Data Mesh

## Core Principles (Zhamak Dehghani)

1. **Domain-oriented ownership** — each domain team owns its data products
2. **Data as a product** — treat data with the same rigor as user-facing products
3. **Self-serve data platform** — infrastructure team provides tools, domain teams use them
4. **Federated computational governance** — global policies, local execution

## vs. Data Lake / Data Warehouse

| Aspect | Centralized | Data Mesh |
|---|---|---|
| Ownership | Central data team | Domain teams |
| Architecture | Monolithic pipeline | Distributed data products |
| Scaling | Bottleneck at data team | Scales with org |
| Quality | Central team responsible | Domain team responsible |

## Data Product

A data product includes:
- The data itself
- Code that produces it
- Metadata and documentation
- Quality guarantees (SLAs)
- Access mechanisms (API, SQL, events)

## When to Use

Large organizations (100+ engineers) with multiple domains producing data. Small teams should start with a simple warehouse.

See [[arch-001]], [[arch-007]], [[database-sharding]].
