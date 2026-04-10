# Integration Patterns Overview

A quick reference of enterprise integration patterns (Hohpe & Woolf).

## Message Patterns

- **Message Channel** — a named pipe between sender and receiver
- **Message Router** — routes messages based on content or headers
- **Message Translator** — converts between formats
- **Message Filter** — discards unwanted messages
- **Message Splitter** — splits a composite message into individual messages
- **Message Aggregator** — combines related messages into one

## Endpoint Patterns

- **Polling Consumer** — periodically checks for new messages
- **Event-Driven Consumer** — reacts to message arrival
- **Competing Consumers** — multiple consumers on one channel
- **Idempotent Receiver** — handles duplicate messages

## Channel Patterns

- **Point-to-Point** — one sender, one receiver
- **Publish-Subscribe** — one sender, many receivers
- **Dead Letter Channel** — for undeliverable messages
- **Guaranteed Delivery** — persistent messages

## Routing Patterns

- **Content-Based Router** — inspect message, route to appropriate channel
- **Message Broker** — central hub for routing
- **Scatter-Gather** — broadcast + aggregate responses

See [[arch-003]], [[arch-053]], [[arch-078]].
