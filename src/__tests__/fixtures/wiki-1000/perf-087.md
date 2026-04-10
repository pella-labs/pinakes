# Image Optimization

## Format Selection

| Format | Best For | Compression |
|---|---|---|
| WebP | Photos, illustrations | 25-35% smaller than JPEG |
| AVIF | Photos (next-gen) | 50% smaller than JPEG |
| SVG | Icons, logos, simple graphics | Lossless, scalable |
| PNG | Lossless photos, screenshots | Larger files |

## Responsive Images

Serve different sizes based on viewport:

```html
<picture>
  <source srcset="image-400.webp 400w, image-800.webp 800w, image-1200.webp 1200w"
          type="image/webp" sizes="(max-width: 600px) 100vw, 50vw">
  <img src="image-800.jpg" alt="Descriptive text" loading="lazy">
</picture>
```

## Build-Time Optimization

Integrate image optimization into the build pipeline:

```bash
# Sharp for Node.js
sharp input.jpg
  .resize(1200, null, { withoutEnlargement: true })
  .webp({ quality: 80 })
  .toFile('output.webp')
```

## CDN Image Transformation

Modern CDNs offer on-the-fly image transformation via URL parameters. This eliminates the need to pre-generate every size:

```
https://cdn.example.com/image.jpg?w=800&format=webp&quality=80
```

## Lazy Loading

Use `loading="lazy"` for below-the-fold images and `loading="eager"` (default) for above-the-fold hero images.

See [[perf-048]] for lazy loading and [[perf-078]] for compression.
