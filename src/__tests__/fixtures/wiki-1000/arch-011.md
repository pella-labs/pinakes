# Service Mesh Basics

## What Is a Service Mesh?

A **service mesh** is an infrastructure layer that manages service-to-service communication. It typically uses sidecar proxies (like Envoy) deployed alongside each service instance.

## Core Capabilities

- **Traffic management** — routing, load balancing, retries, timeouts
- **Observability** — distributed tracing, metrics, access logs
- **Security** — mutual TLS, authorization policies
- **Resilience** — circuit breaking, fault injection, rate limiting

## Popular Implementations

- **Istio** — full-featured, complex, Envoy-based
- **Linkerd** — lighter weight, Rust-based proxy
- **Consul Connect** — HashiCorp's entry, integrates with Consul service discovery

## When You Don't Need One

If you have fewer than 10 services or a small team, a service mesh adds more operational overhead than it saves. Use application-level libraries (like resilience4j) instead.

See [[k8s-deployment]], [[monitoring-prometheus]], [[arch-014]].
