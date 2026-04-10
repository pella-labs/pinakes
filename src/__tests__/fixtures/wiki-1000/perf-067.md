# Service Mesh Performance Impact

## What a Service Mesh Adds

A **service mesh** (Istio, Linkerd) injects a sidecar proxy alongside every service instance. Every request passes through two proxies: the source sidecar and the destination sidecar.

## Latency Overhead

Each proxy hop adds 1-5ms of latency. For a chain of 5 services, that's 10-50ms of additional mesh latency. On high-throughput services, proxy CPU consumption becomes significant.

## Reducing Mesh Overhead

- Use **eBPF-based meshes** (Cilium) to bypass the sidecar proxy for L3/L4 operations
- Tune proxy concurrency to match pod CPU limits
- Disable mTLS for internal-only services if your threat model allows it
- Use headless services for gRPC to enable direct pod-to-pod connections

## When to Skip the Mesh

Not every service needs a mesh. Avoid mesh overhead for:

- Internal batch processing jobs
- High-throughput data pipelines
- Services with single-digit latency budgets

## Observability Benefits

Despite the latency cost, service meshes provide valuable observability:

- Automatic distributed tracing
- Per-service request metrics (golden signals)
- mTLS for zero-trust networking
- Traffic management (canary, circuit breaking)

The question is whether these benefits justify the latency and resource cost for your use case.

See [[perf-051]] for gRPC performance and [[perf-018]] for tracing.
