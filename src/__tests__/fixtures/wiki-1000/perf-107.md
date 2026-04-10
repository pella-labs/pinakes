# Caching with Consistent Hashing

## The Rehashing Problem

With modulo-based hash distribution (`hash(key) % N`), adding or removing a server remaps almost every key. With 100 servers, adding one remaps ~99% of keys, causing a cache stampede.

## Consistent Hashing Solution

**Consistent hashing** maps both servers and keys onto a ring. Each key maps to the nearest server clockwise on the ring. Adding or removing a server only remaps keys that fall between the new server and its predecessor — typically `1/N` of all keys.

## Virtual Nodes

Real-world consistent hashing uses **virtual nodes** (vnodes). Each physical server is mapped to multiple points on the ring. This ensures even distribution even with a small number of servers.

Typical vnode count: 100-200 per physical server.

## Implementation Sketch

```typescript
class ConsistentHashRing {
  private ring: Map<number, string> = new Map();
  private sortedHashes: number[] = [];

  constructor(private vnodes: number = 150) {}

  addServer(server: string): void {
    for (let i = 0; i < this.vnodes; i++) {
      const hash = this.hash(`${server}:${i}`);
      this.ring.set(hash, server);
      this.sortedHashes.push(hash);
    }
    this.sortedHashes.sort((a, b) => a - b);
  }

  getServer(key: string): string {
    const hash = this.hash(key);
    const idx = this.sortedHashes.findIndex(h => h >= hash);
    return this.ring.get(this.sortedHashes[idx >= 0 ? idx : 0])!;
  }

  private hash(key: string): number { /* MurmurHash3 */ }
}
```

See [[perf-029]] for load balancing and [[perf-001]] for cache invalidation.
