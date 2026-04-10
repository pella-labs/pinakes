# Micro Frontend Architecture

## Problem

A large frontend monolith is hard to scale across teams. Different teams want different frameworks, deployment cadences, and testing strategies.

## Solution

Split the frontend into **micro frontends**, each owned by a team, independently deployable.

## Composition Strategies

### Build-Time
Package micro frontends as npm packages. Bundle at build time.

### Runtime (Module Federation)
Webpack Module Federation loads micro frontends at runtime.

### Server-Side
Edge server composes HTML fragments from multiple services.

### iframes
Strongest isolation. Weakest user experience.

## Shared Concerns

- Routing — a shell app or router decides which micro frontend to mount
- Styling — CSS isolation (shadow DOM, CSS modules, naming conventions)
- State — shared state via events or a micro state manager
- Auth — single auth flow, token shared across micro frontends

## When to Use

Teams of 20+ engineers working on the same frontend. Below that threshold, a monolith with good module boundaries is simpler.

See [[frontend-react]], [[arch-025]], [[arch-001]].
