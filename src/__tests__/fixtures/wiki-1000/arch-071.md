# API Versioning Strategies

## URL Versioning

```
GET /api/v1/orders
GET /api/v2/orders
```

Simple, explicit. Downsides: URL pollution, clients must update URLs.

## Header Versioning

```
GET /api/orders
Accept: application/vnd.myapp.v2+json
```

Clean URLs. Harder to test in browsers.

## Query Parameter

```
GET /api/orders?version=2
```

Easy to use. Feels hacky for a fundamental API property.

## Content Negotiation

Use `Accept` headers with media types. Most RESTful, but complex.

## Which to Choose?

For public APIs: URL versioning (clear, cacheable, easy to document).
For internal APIs: header versioning or just don't version (evolve with backward compatibility).

## Backward Compatibility Rules

- Adding fields is safe
- Removing fields is breaking
- Changing field types is breaking
- Adding optional parameters is safe
- Changing behavior for existing parameters is breaking

See [[api-rest-design]], [[arch-012]].
