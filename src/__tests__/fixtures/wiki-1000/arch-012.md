# API Gateway Pattern

## Purpose

An **API gateway** is a single entry point for all client requests. It handles cross-cutting concerns before routing to backend services.

## Responsibilities

- Request routing
- Authentication and authorization
- Rate limiting
- Response caching
- Request/response transformation
- API versioning
- SSL termination

## Implementation Options

| Option | Best For |
|---|---|
| Kong | Plugin ecosystem, Lua extensibility |
| AWS API Gateway | Serverless, tight AWS integration |
| Envoy | High-performance, programmable |
| Traefik | Docker/K8s native, auto-discovery |
| Custom (Express/Fastify) | Full control, small scale |

## Backend for Frontend (BFF)

Instead of one gateway for all clients, create **specialized gateways** per client type (web, mobile, IoT). Each BFF aggregates and transforms data for its client's needs.

See [[api-rest-design]], [[auth-oauth2]], [[arch-011]].
