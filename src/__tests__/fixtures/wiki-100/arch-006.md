# Service Mesh Architecture

A **service mesh** provides infrastructure-level networking capabilities to microservices without requiring changes to application code. It handles service discovery, load balancing, encryption, observability, and traffic management through sidecar proxies.

## Sidecar Proxy Pattern

Each service instance gets a co-deployed proxy (the sidecar). All inbound and outbound traffic flows through this proxy. The most common implementations are **Envoy** (used by Istio and Linkerd2-proxy) and **NGINX**.

The sidecar intercepts every network call, which means:

- Mutual TLS is automatic — services don't manage certificates
- Retries, timeouts, and [[circuit-breakers]] are configured externally
- Traffic metrics are collected without application instrumentation
- Canary deployments and traffic splitting happen at the mesh level

## Control Plane vs Data Plane

The **data plane** is the collection of sidecar proxies handling actual traffic. The **control plane** manages configuration, certificate distribution, and policy enforcement.

```yaml
# Istio VirtualService — traffic splitting for canary deployment
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: order-service
spec:
  hosts:
    - order-service
  http:
    - route:
        - destination:
            host: order-service
            subset: stable
          weight: 90
        - destination:
            host: order-service
            subset: canary
          weight: 10
```

## When to Adopt

A service mesh adds operational complexity. It's justified when you have:

- More than 15-20 services in production
- Strict security requirements (mTLS everywhere)
- Need for fine-grained traffic management
- Multiple teams needing consistent observability (see [[monitoring-setup]])

For smaller deployments, a simple HTTP client library with retry logic and a shared [[auth-flow]] middleware may be sufficient.
