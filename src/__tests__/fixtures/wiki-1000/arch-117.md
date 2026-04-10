# Testing Microservices

## Testing Pyramid for Microservices

```
         /  E2E  \        (few, expensive, slow)
        / Contract \      (moderate, verify API contracts)
       / Integration \    (moderate, test DB/queue/HTTP)
      /    Unit       \   (many, fast, cheap)
```

## Contract Testing

Use **Pact** or **Spring Cloud Contract** to verify that service A's expectations about service B's API match B's actual behavior.

### Consumer-Driven Contracts
1. Consumer records its expectations
2. Provider verifies against those expectations
3. Both sides are tested independently

## Integration Testing

Test one service against real dependencies (database, message broker) using Docker containers (Testcontainers).

## E2E Testing

Deploy the full system and run smoke tests. Keep these minimal — they're slow and flaky.

## Testing in Production

- Canary deployments
- Feature flags for dark launches
- Synthetic transactions (fake orders that exercise the full flow)
- Traffic mirroring (copy real traffic to new version, compare results)

See [[testing-integration]], [[arch-001]], [[arch-059]].
