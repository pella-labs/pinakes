---
title: TCP Optimization
tags: [networking, tcp, performance]
---
# TCP Optimization

## Connection Setup Cost

TCP's three-way handshake adds one round-trip before data flows. With TLS, add 1-2 more round-trips. At 100ms RTT, that's 200-300ms before the first byte of application data.

## Keep-Alive

Reuse TCP connections across multiple HTTP requests:

```
Connection: keep-alive
Keep-Alive: timeout=60, max=1000
```

HTTP/2 multiplexes multiple requests over a single connection, making keep-alive even more valuable.

## Tuning TCP Parameters

```bash
# Increase send/receive buffers
sysctl -w net.core.rmem_max=16777216
sysctl -w net.core.wmem_max=16777216

# Enable TCP fast open (skip handshake for repeat connections)
sysctl -w net.ipv4.tcp_fastopen=3

# Tune congestion control
sysctl -w net.ipv4.tcp_congestion_control=bbr
```

## BBR Congestion Control

Google's **BBR** (Bottleneck Bandwidth and Round-trip propagation time) congestion control algorithm achieves higher throughput than CUBIC on lossy networks by modeling the bottleneck bandwidth rather than reacting to packet loss.

## Nagle's Algorithm

Nagle's algorithm batches small writes into larger TCP segments. For latency-sensitive applications (real-time APIs, WebSockets), disable it:

```typescript
socket.setNoDelay(true);
```

See [[perf-049]] for DNS optimization.
