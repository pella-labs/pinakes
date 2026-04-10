# Immutable Infrastructure

## Concept

Never modify running servers. Instead, build a new image with changes and replace the old instances.

## Process

1. Code change → CI builds new container image
2. New image deployed alongside old (blue/green or rolling)
3. Traffic shifted to new instances
4. Old instances terminated

## Benefits

- No configuration drift
- Reproducible environments
- Easy rollback (redeploy previous image)
- No snowflake servers

## Tools

- **Docker** — container images
- **Packer** — VM images (AMI, GCE)
- **Terraform** — infrastructure provisioning
- **Kubernetes** — orchestration with declarative desired state

## Anti-Pattern: Mutable Infrastructure

SSH into a server, apt-get install, edit config files. Over time, no two servers are alike. Debugging is a nightmare.

See [[k8s-deployment]], [[arch-036]].
