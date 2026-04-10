# Service Discovery

**Service discovery** is the mechanism by which services locate each other in a dynamic environment where instances come and go. In containerized and cloud-native deployments, hardcoded IP addresses don't work.

## Client-Side Discovery

The client queries a **service registry** to get a list of available instances, then selects one using a load balancing strategy (round-robin, least connections, random).

Examples: Netflix Eureka, Consul with client libraries.

## Server-Side Discovery

The client sends requests to a load balancer or router, which queries the registry and forwards the request to an available instance. The client doesn't need to know about the registry.

Examples: AWS ALB with ECS service discovery, Kubernetes Services (kube-proxy), [[arch-006]] service mesh proxies.

## DNS-Based Discovery

Services register themselves with a DNS server. Clients resolve the service name to one or more IP addresses. Simple and universal but limited by DNS TTL caching — stale records point to dead instances.

Kubernetes uses CoreDNS for internal service discovery. A service named `order-service` in namespace `production` is reachable at `order-service.production.svc.cluster.local`.

## Health Checking

Service discovery is only as good as its health data. Registries need:

- **Liveness checks**: is the process running?
- **Readiness checks**: can the service handle traffic?
- **Deregistration on failure**: remove unhealthy instances from the registry promptly

See [[monitoring-setup]] for health check endpoint design and [[deploy-pipeline]] for integration with deployment orchestration.
