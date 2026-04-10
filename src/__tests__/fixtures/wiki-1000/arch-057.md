# Infrastructure as Code

## What It Is

**Infrastructure as Code** (IaC) manages infrastructure through version-controlled definition files rather than manual processes.

## Tools

| Tool | Approach | State |
|---|---|---|
| Terraform | Declarative, provider-agnostic | Remote state file |
| Pulumi | Imperative (real code), multi-language | Remote state |
| CloudFormation | Declarative, AWS-only | AWS-managed |
| CDK | Imperative → CloudFormation | AWS-managed |
| Ansible | Procedural, agentless | Stateless |

## Best Practices

- Store IaC in the same repo as application code (or a dedicated infra repo)
- Use modules/components for reusability
- Apply the same code review process as application code
- Use remote state with locking (S3 + DynamoDB for Terraform)
- Never store secrets in IaC files

## Testing

- **terraform validate** — syntax check
- **terraform plan** — preview changes
- **Terratest** — integration tests for infrastructure
- **Policy as code** — OPA/Sentinel for compliance

See [[k8s-deployment]], [[arch-056]].
