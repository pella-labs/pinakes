# Load Balancing Strategies

## Algorithms

### Round Robin
Distributes requests sequentially across backends. Simple but ignores server capacity and current load.

### Least Connections
Routes to the server with the fewest active connections. Better for heterogeneous backends or variable request duration.

### Weighted Round Robin
Assigns weights to servers based on capacity. A server with weight 3 receives three times the traffic of a server with weight 1.

### Consistent Hashing
Routes requests based on a hash of the request key (user ID, session ID). Ensures the same user always hits the same backend, useful for local caching.

## Health Checks

Active health checks send periodic probes to backends. Passive health checks monitor actual traffic for failures. Use both:

- Active: every 10s, mark unhealthy after 3 consecutive failures
- Passive: track 5xx responses, mark unhealthy if error rate > 50% in 30s window

## Layer 4 vs Layer 7

**Layer 4** (TCP) load balancers route based on IP and port. Fast but cannot inspect HTTP headers. **Layer 7** (HTTP) load balancers can route based on URL path, headers, cookies, and request body. More flexible but higher overhead.

## Graceful Draining

When removing a server from the pool, stop sending new requests but allow in-flight requests to complete. This prevents connection resets and failed requests during deployments.

See [[perf-009]] for connection pooling.
