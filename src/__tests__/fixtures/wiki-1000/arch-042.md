# Multi-Tenancy Architecture

## Strategies

### Shared Everything
All tenants in the same database, same schema. Differentiated by a `tenant_id` column.

### Schema per Tenant
Same database, separate schemas. Better isolation, moderate overhead.

### Database per Tenant
Maximum isolation. Expensive, but some enterprise customers require it.

## Trade-offs

| Strategy | Isolation | Cost | Complexity |
|---|---|---|---|
| Shared everything | Low | Low | Low |
| Schema per tenant | Medium | Medium | Medium |
| Database per tenant | High | High | High |

## Implementation Concerns

- **Row-level security** — every query must filter by tenant_id (easy to forget, catastrophic to miss)
- **Migrations** — schema-per-tenant means N migrations instead of 1
- **Noisy neighbor** — one tenant's heavy query affects others in shared DB
- **Data residency** — some tenants require data in specific regions

## Hybrid Approach

Default to shared-everything. Offer dedicated databases for enterprise tier. Route at the application layer based on tenant configuration.

See [[database-sharding]], [[auth-oauth2]].
