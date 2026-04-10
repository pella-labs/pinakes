# Connection Pooling

## Why Pool?

Database connections are expensive to create (TCP handshake, auth, SSL negotiation). A **connection pool** maintains a set of open connections and reuses them.

## Configuration

Key parameters:
- **min** — minimum idle connections (keep warm)
- **max** — maximum total connections (prevent overload)
- **idle_timeout** — close connections idle for too long
- **connection_timeout** — max wait time for a connection from the pool

## PgBouncer

For PostgreSQL, **PgBouncer** is the standard connection pooler:

```ini
[databases]
myapp = host=127.0.0.1 port=5432 dbname=myapp

[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 20
```

Pool modes:
- **session** — one server connection per client session
- **transaction** — connection returned after each transaction (recommended)
- **statement** — connection returned after each statement (limited)

## SQLite Note

SQLite doesn't benefit from connection pooling in the traditional sense. Single writer, WAL mode, busy timeout is the right approach.

See [[database-sharding]], [[arch-065]].
