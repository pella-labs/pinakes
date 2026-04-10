# Architecture Review Checklist

## Questions to Ask

### Scalability
- What are the scaling bottlenecks?
- Can we scale each component independently?
- What's the expected growth rate?

### Reliability
- What are the failure modes?
- How do we detect failures?
- What's the blast radius of each failure?
- What's our recovery strategy?

### Security
- What's the authentication/authorization model?
- Where are secrets stored?
- What data is sensitive and how is it protected?
- What's the attack surface?

### Operability
- How do we deploy changes?
- How do we monitor the system?
- How do we debug production issues?
- What does the on-call experience look like?

### Simplicity
- Could we achieve the same goals with a simpler design?
- What's the cognitive load for a new team member?
- Are we building for today's requirements or imagined future ones?

### Cost
- What's the infrastructure cost?
- What's the engineering maintenance cost?
- Where are we paying for complexity we don't need?

See [[arch-064]], [[monitoring-prometheus]], [[testing-integration]].
