# Sidecar Pattern

## Concept

Deploy a helper process alongside your main application in the same pod/host. The **sidecar** handles cross-cutting concerns without modifying the main application code.

## Common Use Cases

- **Logging agent** — ships logs to a central system
- **Proxy** — handles mTLS, retries, circuit breaking (Envoy)
- **Config sync** — watches a config source and updates local files
- **Metrics exporter** — scrapes the app and exposes Prometheus metrics

## Benefits

- Language-agnostic (sidecar can be in a different language)
- Independent lifecycle (update sidecar without redeploying the app)
- Clean separation of concerns

## Downsides

- Resource overhead (extra CPU/memory per pod)
- Debugging is harder (two processes instead of one)
- Latency added by local proxy hops

See [[k8s-deployment]], [[arch-011]].
