---
title: Microservice Communication Patterns
tags: [microservices, architecture, performance]
created: 2025-11-20
---
# Microservice Communication Patterns

## Synchronous vs Asynchronous

### Synchronous (Request-Response)
- HTTP/REST, gRPC
- Simple mental model
- Tight coupling: caller blocks until response
- Cascading failures if downstream is slow

### Asynchronous (Event-Driven)
- Message queues, event streams
- Loose coupling: producer doesn't know about consumers
- Higher complexity (eventual consistency)
- Better fault isolation

## API Gateway Pattern

A single entry point that routes, authenticates, rate-limits, and transforms requests before forwarding to backend services. Reduces client complexity but adds latency.

## Backend-for-Frontend (BFF)

Dedicated backend service per frontend (web, mobile, CLI). Each BFF aggregates data from multiple microservices, optimized for its client's needs.

## Service-to-Service Authentication

- **mTLS**: both client and server present certificates
- **JWT**: signed tokens with scopes and expiration
- **Service mesh**: sidecar proxy handles authentication transparently

## Performance Considerations

- Minimize call depth (each hop adds latency)
- Use async communication for non-blocking workflows
- Cache frequently accessed data locally to reduce cross-service calls
- Use circuit breakers to prevent cascade failures

See [[perf-051]] for gRPC and [[perf-031]] for circuit breakers.
