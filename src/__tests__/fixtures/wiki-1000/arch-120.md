# Reactive Architecture

## Reactive Manifesto

A reactive system is:
- **Responsive** — timely responses
- **Resilient** — stays responsive during failure
- **Elastic** — stays responsive under varying workload
- **Message-driven** — relies on async message passing

## Reactive Streams

A standard for async stream processing with backpressure:
- **Publisher** — produces data
- **Subscriber** — consumes data
- **Subscription** — mediates (subscriber requests N items)
- **Processor** — both publisher and subscriber (transforms data)

## Implementations

- **RxJS** (JavaScript) — reactive extensions
- **Project Reactor** (Java) — Spring WebFlux
- **Akka Streams** (Scala/Java) — actor-based
- **Node.js Streams** — built-in readable/writable/transform

## When to Use

- High-concurrency I/O-bound services
- Real-time data processing
- Systems that need elastic scaling

## When Not to Use

- CPU-bound computation (use worker threads instead)
- Simple CRUD (adds unnecessary complexity)

See [[arch-087]], [[arch-003]].
