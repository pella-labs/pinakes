# Versioned APIs and Consumer Contracts

## The Problem

You have N consumers of your API. Changing the API risks breaking them. How do you evolve safely?

## Consumer-Driven Contracts

Each consumer publishes a contract (the subset of the API it uses). The provider runs all consumer contracts in its CI pipeline.

## Backward-Compatible Changes

Safe changes (no version bump needed):
- Add new fields to responses
- Add new optional request parameters
- Add new endpoints

## Breaking Changes

Require a version bump:
- Remove fields from responses
- Change field types
- Remove endpoints
- Change required request parameters

## Sunset Policy

When deprecating a version:
1. Announce deprecation with a timeline
2. Return `Sunset` and `Deprecation` headers
3. Monitor usage of deprecated versions
4. Remove after sunset date

```
Sunset: Sat, 01 Mar 2025 00:00:00 GMT
Deprecation: true
Link: <https://api.example.com/v3>; rel="successor-version"
```

See [[api-rest-design]], [[arch-071]].
