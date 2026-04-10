# Sidecar Injection in Kubernetes

## Automatic Injection

Istio and Linkerd use **admission webhooks** to automatically inject sidecar containers into pods.

```yaml
# Istio: label the namespace
apiVersion: v1
kind: Namespace
metadata:
  name: my-app
  labels:
    istio-injection: enabled
```

Every pod in this namespace gets an Envoy sidecar injected.

## What Gets Injected

```yaml
# After injection, pod spec includes:
containers:
  - name: my-app
    image: my-app:v1
  - name: istio-proxy        # injected sidecar
    image: istio/proxyv2
    ports:
      - containerPort: 15090  # Prometheus metrics
    resources:
      requests:
        cpu: 10m
        memory: 40Mi
```

## Resource Overhead

Each sidecar consumes ~40-100MB RAM and ~10-50m CPU. Multiply by pod count. For 1000 pods, that's 40-100GB of RAM just for sidecars.

## Alternatives

- **Sidecarless** service mesh (Ambient Mesh in Istio, Linkerd per-node proxy)
- **eBPF-based** (Cilium) — kernel-level networking, no sidecar

See [[k8s-deployment]], [[arch-011]], [[arch-026]].
