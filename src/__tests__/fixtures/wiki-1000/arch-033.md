# Backend for Frontend (BFF)

## The Problem

Mobile clients need compact payloads. Web clients need rich data. A single API that serves both ends up being a compromise for everyone.

## The Solution

Create a **dedicated API layer per client type**. Each BFF is tailored to its frontend's needs.

```
Mobile App → [Mobile BFF] → Backend Services
Web App    → [Web BFF]    → Backend Services
Partner API → [Partner BFF] → Backend Services
```

## Responsibilities

Each BFF handles:
- Aggregation (combine multiple backend calls)
- Transformation (reshape data for the client)
- Client-specific auth flows
- Response size optimization

## Ownership

The frontend team owns the BFF. This gives them control over the data contract without waiting on backend teams.

## Pitfalls

- Logic duplication across BFFs — extract shared logic into backend services
- BFF becoming a monolith — keep it thin, just aggregation and transformation
- Too many BFFs — one per client platform is usually enough

See [[arch-012]], [[api-rest-design]], [[frontend-react]].
