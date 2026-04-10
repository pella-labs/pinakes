# Content Compression

## Compression at the HTTP Layer

Compressing HTTP responses reduces transfer size by 60-90% for text-based content.

## Algorithm Comparison

| Algorithm | Compression Ratio | Speed | Browser Support |
|---|---|---|---|
| gzip | Good | Good | Universal |
| Brotli (br) | Better (+15-25%) | Slower | Modern browsers |
| zstd | Best for some content | Fast | Limited |

## Server Configuration

```bash
# Nginx gzip
gzip on;
gzip_types text/plain text/css application/json application/javascript;
gzip_min_length 256;
gzip_comp_level 6;

# Nginx Brotli (requires module)
brotli on;
brotli_comp_level 6;
brotli_types text/plain text/css application/json application/javascript;
```

## Static Pre-Compression

Compress static assets at build time instead of on every request:

```bash
# Pre-compress with Brotli
brotli -q 11 dist/*.js dist/*.css

# Nginx serves pre-compressed files
gzip_static on;
brotli_static on;
```

Level 11 Brotli is too slow for dynamic compression but produces the smallest files for static content.

## What Not to Compress

- Already compressed formats: images (JPEG, PNG, WebP), video, ZIP files
- Responses smaller than ~150 bytes (compression overhead exceeds savings)
- Encrypted payloads (compression before encryption can leak information)

See [[perf-005]] for CDN strategy and [[perf-060]] for HTTP/2.
