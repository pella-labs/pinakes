# Microservices Architecture Overview

## Core Principles

**Microservices** decompose a system into independently deployable services, each owning a single **bounded context**. Communication happens over well-defined APIs — typically REST or gRPC.

## When to Use

- Team size exceeds 8-10 engineers working on one codebase
- Different components have vastly different scaling requirements
- You need independent deployment cycles per feature area

## Key Trade-offs

The main benefit is **organizational scalability** — teams can ship without coordinating deploys. The cost is operational complexity: distributed tracing, service discovery, network partitions, and data consistency all become your problem.

See also [[api-rest-design]], [[monitoring-prometheus]], [[k8s-deployment]].

## Common Mistakes

- Starting with microservices before you understand your domain boundaries
- Sharing databases between services (defeats the purpose)
- Not investing in observability from day one
- Treating microservices as a silver bullet for a slow monolith
