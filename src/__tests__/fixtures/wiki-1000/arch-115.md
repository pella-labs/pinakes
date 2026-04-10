# Cell-Based Architecture

## Concept

Partition the entire application stack (compute, storage, networking) into independent **cells**. Each cell serves a subset of users and is fully isolated from other cells.

## Why

Blast radius control. If cell 3 has an outage, only the users assigned to cell 3 are affected. Other cells continue normally.

## Cell Assignment

Route users to cells based on:
- Account ID (hash to cell)
- Geographic region
- Tenant tier (premium customers get dedicated cells)

## AWS Example

Each cell is a complete stack:
- Own VPC
- Own ECS/EKS cluster
- Own RDS instance
- Own ElastiCache
- Shared cell router at the edge

## Trade-offs

- Excellent blast radius containment
- Expensive (full stack per cell)
- Cross-cell operations are hard
- Cell rebalancing is complex

See [[arch-065]], [[arch-042]], [[arch-028]].
