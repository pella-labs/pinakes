# DNS Performance

## DNS Resolution Chain

Every HTTP request starts with DNS resolution. The chain: browser cache → OS cache → recursive resolver → root → TLD → authoritative. Each step adds latency.

## Optimizing DNS

### Lower TTLs for Failover
Low TTLs (60-300s) enable fast failover but increase DNS query volume. High TTLs (3600s+) reduce queries but slow failover.

### DNS Prefetching
```html
<link rel="dns-prefetch" href="//api.example.com">
```
Resolve third-party domains before the browser needs them.

### Multiple DNS Providers
Use two authoritative DNS providers for redundancy. If one has an outage, the other serves queries.

### Anycast DNS
Anycast routes DNS queries to the nearest server, reducing resolution latency globally.

## Monitoring DNS

- Track resolution time per domain
- Monitor TTL violations (resolvers ignoring TTL)
- Alert on NXDOMAIN spikes (potential misconfiguration)
- Test from multiple geographic locations

## DNS as a Failure Point

DNS outages cause total service unavailability. Mitigations include client-side DNS caching with stale-while-revalidate semantics and happy-eyeballs (parallel A/AAAA resolution with race-to-connect).

See [[perf-029]] for load balancing.
