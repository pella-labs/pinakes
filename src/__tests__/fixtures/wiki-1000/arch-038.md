# Service Discovery

## Problem

In a dynamic environment (containers, auto-scaling), service locations change constantly. Hard-coded addresses don't work.

## Client-Side Discovery

The client queries a service registry and load-balances across instances.

## Server-Side Discovery

The client talks to a load balancer, which queries the registry.

## Tools

- **Consul** — health checking, KV store, DNS interface
- **Kubernetes DNS** — built-in, service names resolve to cluster IPs
- **Eureka** — Netflix, Java ecosystem
- **etcd** — key-value store, often used with custom discovery logic

## DNS vs. API

DNS-based discovery is simpler but has TTL caching issues. API-based discovery is more responsive but requires client libraries.

See [[k8s-deployment]], [[arch-011]], [[arch-012]].
