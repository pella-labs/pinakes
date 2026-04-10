# Scaling Strategies

## Vertical Scaling (Scale Up)

Add more resources to a single machine: more CPU, RAM, faster disk. Simple but has a ceiling.

## Horizontal Scaling (Scale Out)

Add more machines. Requires stateless applications and distributed state management.

## Scaling Axes (AKF Scale Cube)

1. **X-axis** — clone the application behind a load balancer
2. **Y-axis** — split by function (microservices)
3. **Z-axis** — split by data (sharding)

## Database Scaling

- **Read replicas** — scale reads horizontally
- **Sharding** — scale writes horizontally (expensive, complex)
- **Caching** — reduce database load entirely
- **Connection pooling** — PgBouncer, ProxySQL

## Stateless Application Pattern

For horizontal scaling, the application must be stateless:
- No local file storage (use S3/GCS)
- No in-memory sessions (use Redis/DB)
- No local cron jobs (use a job scheduler)

See [[database-sharding]], [[perf-caching]], [[k8s-deployment]].
