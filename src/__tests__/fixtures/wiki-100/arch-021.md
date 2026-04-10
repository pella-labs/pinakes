# Configuration Management Patterns

Managing configuration across environments and services is a cross-cutting concern that affects every layer of the architecture. Getting it wrong leads to secrets in source control, environment-specific bugs, and deployment failures.

## Configuration Hierarchy

Configuration should be layered, with later layers overriding earlier ones:

1. **Defaults** — sensible defaults baked into the application
2. **Config files** — `config.yaml` or `.env` checked into version control (no secrets)
3. **Environment variables** — set by the deployment platform
4. **Secret manager** — Vault, AWS Secrets Manager, GCP Secret Manager
5. **Remote config** — feature flags, runtime toggles

## Environment Variables

The twelve-factor app methodology mandates configuration via environment variables. This works well for simple cases but becomes unwieldy with dozens of settings.

```typescript
// Typed config with validation at startup
const config = {
  port: requireEnvInt('PORT', 3000),
  dbUrl: requireEnv('DATABASE_URL'),
  logLevel: requireEnvEnum('LOG_LEVEL', ['debug', 'info', 'warn', 'error'], 'info'),
  featureFlags: {
    newCheckout: requireEnvBool('FF_NEW_CHECKOUT', false),
  },
} as const;

function requireEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}
```

## Secrets Management

Never store secrets in environment variables on disk (`.env` files committed to git). Use a secrets manager with:

- **Rotation support**: automated credential rotation without redeployment
- **Audit logging**: who accessed what, when
- **Least privilege**: services only access the secrets they need

See [[auth-flow]] for service-to-service authentication patterns and [[deploy-pipeline]] for secrets injection during deployment.
