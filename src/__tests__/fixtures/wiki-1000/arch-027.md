# Ambassador Pattern

The **ambassador pattern** is a specialized sidecar that acts as a proxy for outbound connections.

## Use Case

Your application connects to a remote service. Instead of embedding retry logic, circuit breaking, and tracing into the app, you route through an ambassador proxy that handles all of that.

## Example

```yaml
# K8s pod spec
containers:
  - name: app
    image: myapp:v2
    env:
      - name: DB_HOST
        value: "localhost"  # talks to ambassador, not directly to DB
      - name: DB_PORT
        value: "5432"
  - name: ambassador
    image: pgbouncer:latest  # connection pooling + routing
    ports:
      - containerPort: 5432
```

The app thinks it's talking to a local database. The ambassador handles connection pooling, failover, and TLS.

See [[arch-026]], [[k8s-deployment]].
