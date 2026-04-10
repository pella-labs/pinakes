# Configuration Management Patterns

## Hierarchy of Configuration

From lowest to highest precedence:
1. Default values in code
2. Configuration files (YAML, JSON, TOML)
3. Environment variables
4. Command-line arguments
5. Runtime overrides (feature flags, config service)

## 12-Factor App Config

Store config in the environment. Never commit secrets. Use `.env` files for local dev, environment variables in production.

## Configuration Service

For complex systems, centralize config in a service:
- **Consul KV** — HashiCorp, distributed
- **etcd** — Kubernetes' config store
- **AWS Parameter Store** — managed, encrypted
- **Spring Cloud Config** — Git-backed, versioned

## Rules

- Config changes should not require code changes
- All config should have sensible defaults
- Validate config at startup, fail fast on invalid values
- Log effective config at startup (mask secrets)

See [[k8s-deployment]], [[arch-032]].
