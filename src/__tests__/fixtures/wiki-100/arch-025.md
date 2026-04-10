# Multi-Tenancy Architecture

**Multi-tenancy** allows a single application instance to serve multiple tenants (customers, organizations) while keeping their data isolated. The isolation model is the most critical architectural decision.

## Isolation Models

### Shared Everything

All tenants share the same database, tables, and application instances. Tenant data is separated by a `tenant_id` column on every table. Cheapest to operate but requires discipline — every query must include the tenant filter.

```sql
-- Every query MUST include tenant_id
SELECT * FROM orders
WHERE tenant_id = $1 AND status = 'pending'
ORDER BY created_at DESC;

-- Missing tenant_id = data leak. Enforce via row-level security:
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
```

### Shared Database, Separate Schemas

Each tenant gets its own database schema. Stronger isolation than shared-everything. Schema migrations must run per tenant.

### Separate Databases

Each tenant gets its own database. Strongest isolation but most expensive. Required for regulated industries where data residency matters.

## Tenant Resolution

How does the application know which tenant a request belongs to?

- **Subdomain**: `acme.app.com` resolves to tenant `acme`
- **Header**: `X-Tenant-ID` header (for API clients)
- **JWT claim**: tenant ID embedded in the auth token (see [[auth-flow]])
- **Path prefix**: `/api/tenants/{id}/...` (explicit but verbose)

## Cross-Tenant Concerns

- **Rate limiting**: per-tenant limits to prevent noisy neighbors ([[arch-022]])
- **Resource quotas**: storage, compute, API call limits per tier
- **Audit logging**: tenant-scoped audit trails (critical for compliance)
- **Backups**: tenant-level backup and restore capability

## Performance Isolation

The **noisy neighbor** problem: one tenant's heavy workload degrades performance for others. Mitigation:

- Connection pool partitioning per tenant
- Queue priority by tenant tier
- [[arch-015]] bulkhead pattern for critical tenants
- Dedicated compute for enterprise tenants (hybrid model)

Multi-tenancy interacts with [[database-patterns]] for schema design and [[deploy-pipeline]] for tenant-aware deployment strategies.
