---
source: extracted
---

# Microservices Architecture Overview

Microservices decompose a monolithic application into independently deployable services, each owning a bounded context. This pattern trades deployment simplicity for operational complexity but unlocks independent scaling and team autonomy.

## Core Principles

The key tenets of a well-designed microservices system:

- **Single responsibility**: each service owns one business capability
- **Loose coupling**: services communicate through well-defined interfaces, never sharing databases
- **Independent deployability**: a change to the order service should not require redeploying the payment service
- **Decentralized data management**: each service owns its data store (see [[database-patterns]])

## Communication Patterns

Services talk to each other via synchronous HTTP/gRPC or asynchronous messaging. The choice depends on the consistency requirements of the interaction.

**Synchronous** calls are simpler to reason about but create temporal coupling. If the downstream service is down, the caller fails. This is where [[circuit-breakers]] become essential.

**Asynchronous** messaging via event buses (Kafka, NATS, RabbitMQ) decouples services temporally. The publisher doesn't wait for the consumer. This enables **event-driven architecture** patterns like event sourcing and CQRS (see [[arch-005]]).

## Service Boundaries

Getting boundaries wrong is the most expensive mistake in microservices. A service that's too granular creates a distributed monolith with chatty inter-service calls. A service that's too coarse defeats the purpose.

Use **domain-driven design** to identify bounded contexts. Start with a monolith and extract services along natural seams. The strangler fig pattern works well for incremental migration.

## Trade-offs

Microservices introduce distributed systems problems: network partitions, eventual consistency, distributed tracing, and deployment orchestration. If your team is small (under 10 engineers) and your domain is well-understood, a modular monolith may serve you better. See [[arch-003]] for the hexagonal architecture approach that keeps a monolith modular.
