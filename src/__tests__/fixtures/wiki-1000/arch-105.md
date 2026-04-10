# Temporal Coupling

## Definition

**Temporal coupling** exists when two components must be available at the same time for the system to function.

## Examples

Synchronous HTTP calls create temporal coupling. If service B is down, service A's request fails even though A is healthy.

## Reducing Temporal Coupling

### Message Queues
A publishes a message. B processes it when available. A doesn't wait.

### Event Sourcing
The event store decouples write time from read time.

### Caching
A caches B's last known response. If B is down, A uses the cache (stale but available).

## Trade-off

Reducing temporal coupling increases eventual consistency. The system is more available but data may be stale.

## Zero-Downtime Deployment Implication

Temporal coupling means you can't deploy A and B independently without risking failures during the gap.

See [[arch-003]], [[arch-040]], [[arch-014]].
