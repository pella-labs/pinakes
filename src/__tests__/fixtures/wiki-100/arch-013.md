# Sidecar Pattern

The **sidecar pattern** deploys a helper process alongside the main application container. The sidecar shares the same lifecycle and network namespace as the primary container, extending its capabilities without modifying its code.

## Common Use Cases

- **Logging and log forwarding** (Fluentd, Filebeat)
- **Service mesh proxy** (Envoy, as in [[arch-006]])
- **Configuration management** (Consul agent, Vault agent)
- **Certificate rotation** (cert-manager sidecar)
- **Database proxy** (PgBouncer, Cloud SQL Proxy)

## Kubernetes Implementation

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  template:
    spec:
      containers:
        - name: order-service
          image: myapp/order-service:v2.1
          ports:
            - containerPort: 8080
        - name: log-forwarder
          image: fluent/fluent-bit:2.1
          volumeMounts:
            - name: shared-logs
              mountPath: /var/log/app
        - name: vault-agent
          image: hashicorp/vault:1.15
          args: ["agent", "-config=/etc/vault/agent.hcl"]
      volumes:
        - name: shared-logs
          emptyDir: {}
```

## Communication

The sidecar and main container communicate via:

- **Shared filesystem** (volume mounts)
- **Localhost networking** (they share the same network namespace in k8s)
- **Shared memory** (rare, for performance-critical cases)

## Trade-offs

Sidecars add resource overhead — each pod consumes more memory and CPU. For high-density deployments, this overhead matters. Consider whether a **daemonset** (one per node instead of one per pod) or a shared library could serve the same purpose with less resource waste.
