---
source: extracted
---
# Space-Based Architecture

## Problem

Traditional architectures hit a wall at high concurrency: database contention, session management, network overhead.

## Solution

**Space-based architecture** distributes both processing and data across multiple nodes. Each node has an in-memory data grid and processing logic.

## Components

- **Processing Units** — contain app logic + in-memory data grid
- **Virtualized Middleware** — messaging grid, data grid, processing grid
- **Data Pumps** — async persist to database (eventual consistency)
- **Data Writers** — write to persistent store

## Use Cases

- Concert ticket sales (massive burst traffic)
- Online auctions
- Real-time bidding
- Gaming leaderboards

## Trade-offs

- Very high throughput and low latency
- Complex to implement and debug
- Eventual consistency with persistent store
- Expensive (lots of memory)

This is an extreme architecture for extreme scale. Most systems don't need it.

See [[arch-065]], [[arch-040]].
