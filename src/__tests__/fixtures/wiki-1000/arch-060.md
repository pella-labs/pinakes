# Twelve-Factor App

A methodology for building **SaaS applications**. Originated at Heroku.

## The Factors

1. **Codebase** — one codebase, many deploys
2. **Dependencies** — explicitly declare and isolate
3. **Config** — store in environment
4. **Backing services** — treat as attached resources
5. **Build, release, run** — strict separation
6. **Processes** — stateless, share-nothing
7. **Port binding** — export services via port
8. **Concurrency** — scale out via process model
9. **Disposability** — fast startup, graceful shutdown
10. **Dev/prod parity** — keep environments similar
11. **Logs** — treat as event streams
12. **Admin processes** — run as one-off processes

## Most Violated

In practice, factors 3 (config), 6 (stateless), and 10 (dev/prod parity) are the most commonly violated. Developers store state in local files, commit config to repos, and run SQLite in dev against Postgres in prod.

See [[arch-036]], [[k8s-deployment]].
