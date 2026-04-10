# Hot Path Optimization

## Identify the Hot Path

The **hot path** is the code executed for every request. Optimizing code outside the hot path has negligible impact. Profile first to identify it.

## Techniques

### Minimize Allocations
Every object allocation eventually requires garbage collection. On the hot path, reuse objects, use object pools, or pre-allocate buffers.

### Avoid Virtual Dispatch
In performance-critical loops, prefer direct function calls over interface dispatch. V8's inline caches help, but monomorphic call sites are faster than polymorphic ones.

### Branch Prediction
Arrange conditionals so the common case comes first. CPU branch predictors work better when the same branch is taken consistently.

### Memory Locality
Access data structures sequentially. Arrays of structs beat linked lists because sequential memory access leverages CPU cache prefetching.

### Inlining
Small, frequently called functions should be inlineable. V8 automatically inlines functions under ~600 bytes of bytecode. Avoid features that prevent inlining: `try/catch`, `eval`, `arguments`.

## Diminishing Returns

Optimize until the hot path is no longer the bottleneck. Then stop. Micro-optimizations in cold code are wasted effort.

## Benchmarking Changes

Always benchmark before and after. Intuition about performance is often wrong. Use a microbenchmark framework with statistical analysis.

See [[perf-026]] for profiling and [[perf-108]] for flame graphs.
