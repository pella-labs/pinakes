# Database per Service

## Principle

Each microservice owns its database. No other service accesses it directly.

## Benefits

- Services can choose the best database for their needs (polyglot persistence)
- Schema changes don't affect other services
- Independent scaling and deployment
- Clear data ownership

## Challenges

- **Joins across services** — impossible at the DB level; use API composition or CQRS views
- **Transactions across services** — use sagas instead of distributed transactions
- **Data duplication** — some data will be duplicated across services (e.g., customer name)
- **Reporting** — aggregate data for analytics via event streaming to a data warehouse

## Data Synchronization

Options for keeping data in sync:
1. **Event-driven** — publish domain events, other services subscribe and maintain their own copies
2. **API calls** — query the owning service when needed (adds latency)
3. **CDC** — Change Data Capture streams DB changes to other services

## Practical Advice

Start with a shared database and separate schemas. Extract to separate databases when the coupling becomes a bottleneck.

See [[arch-001]], [[database-sharding]], [[arch-016]].
