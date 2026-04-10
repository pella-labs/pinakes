# Auto-Scaling Best Practices

## Scaling Metrics

Choose metrics that correlate with user experience, not raw resource usage:

- **CPU utilization**: good default but can be misleading for I/O-bound services
- **Request latency**: scale when latency degrades
- **Queue depth**: scale when work is accumulating
- **Custom metrics**: active sessions, concurrent connections

## Scale-Up vs Scale-Out

**Scale-up** (vertical): bigger machines. Simple, no code changes, limited ceiling.
**Scale-out** (horizontal): more instances. Requires stateless design, nearly unlimited ceiling.

Prefer horizontal scaling for production services. Use vertical scaling for databases and other stateful workloads.

## Cooldown Periods

After scaling, wait before evaluating again. Without cooldown, metrics from newly launched instances (still warming up) trigger unnecessary additional scaling.

## Pre-Scaling

For predictable load patterns (morning ramp-up, evening wind-down), schedule scaling actions in advance rather than waiting for reactive triggers.

## Cost Optimization

- Use spot/preemptible instances for workloads that tolerate interruption
- Scale to zero for development and staging environments outside business hours
- Set maximum instance counts to prevent runaway scaling from misconfigured metrics

See [[perf-076]] for HPA in Kubernetes and [[perf-025]] for capacity planning.
