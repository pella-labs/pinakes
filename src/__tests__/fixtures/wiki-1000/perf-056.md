---
title: Benchmarking Methodology
tags: [benchmarking, testing, methodology]
created: 2025-11-08
---
# Benchmarking Methodology

## Common Mistakes

Most benchmarks are meaningless because they violate basic methodology. Avoid:

- **Benchmarking cold starts**: warm up the system before measuring
- **Single-run results**: statistical significance requires multiple runs
- **Ignoring variance**: report percentiles, not just averages
- **Benchmarking in development**: test on production-like hardware
- **Coordinated omission**: the most insidious load testing mistake

## Coordinated Omission

When a load generator waits for a response before sending the next request, slow responses reduce the actual request rate. This means the benchmark under-counts the latency that queued requests would have experienced.

Use **open-loop** load generators (constant arrival rate) rather than closed-loop (wait for response).

## What to Measure

- **Throughput**: requests per second at various concurrency levels
- **Latency distribution**: p50, p90, p95, p99, p99.9
- **Error rate**: at what load do errors appear
- **Resource utilization**: CPU, memory, disk I/O, network at each load level
- **Startup time**: time from cold start to first request served

## Reporting

Always report:
- Hardware specs (CPU, RAM, disk type, network)
- Software versions (OS, runtime, database)
- Configuration (pool sizes, timeouts, buffer sizes)
- Methodology (tool used, duration, warmup, concurrency levels)

See [[perf-025]] for capacity planning.
