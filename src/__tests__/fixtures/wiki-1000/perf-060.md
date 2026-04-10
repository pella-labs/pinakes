# HTTP/2 and HTTP/3 Performance

## HTTP/2 Improvements

HTTP/2 addresses HTTP/1.1 limitations:

- **Multiplexing**: multiple requests over one TCP connection
- **Header compression** (HPACK): reduces overhead for repetitive headers
- **Server push**: proactively send resources before the client requests them
- **Stream prioritization**: important resources load first

## HTTP/3 and QUIC

HTTP/3 replaces TCP with **QUIC** (UDP-based):

- **0-RTT connection establishment**: data flows on the first packet for repeat connections
- **No head-of-line blocking**: a lost packet on one stream doesn't block others
- **Connection migration**: survives network changes (wifi to cellular)
- **Built-in encryption**: TLS 1.3 is mandatory

## When to Adopt HTTP/3

HTTP/3 benefits are most visible on:
- High-latency connections (mobile networks)
- Lossy networks (wifi, cellular)
- Applications with many concurrent streams

For data-center to data-center communication on reliable networks, HTTP/2 is often sufficient.

## Server Configuration

Most reverse proxies (Nginx 1.25+, Caddy, Cloudflare) support HTTP/3. Enable it alongside HTTP/2 as a progressive enhancement:

```
# Nginx
listen 443 quic;
listen 443 ssl;
add_header Alt-Svc 'h3=":443"; ma=86400';
```

See [[perf-050]] for TCP optimization.
