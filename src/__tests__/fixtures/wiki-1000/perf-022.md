# Runbook Writing Guide

## Purpose

A **runbook** is a step-by-step guide for diagnosing and resolving an operational issue. Good runbooks let anyone on-call resolve incidents, not just the engineer who built the system.

## Structure

Every runbook should follow this template:

1. **Alert description**: what the alert means in plain English
2. **Impact assessment**: what users are experiencing
3. **Diagnostic steps**: commands to run, dashboards to check
4. **Resolution steps**: ordered actions to fix the issue
5. **Escalation path**: who to contact if the runbook doesn't resolve it
6. **Post-resolution**: cleanup steps and verification

## Writing Tips

- Write for the worst case: 3am, engineer who's never seen this service
- Include actual commands, not "check the database"
- Show expected output alongside commands
- Update the runbook after every incident where it was used

## Example Diagnostic Section

```bash
# Check if the service is running
kubectl get pods -n payments -l app=payment-service

# Check recent error logs
kubectl logs -n payments -l app=payment-service --since=10m | grep ERROR

# Check database connectivity
kubectl exec -it payments-db-0 -- pg_isready

# Check queue depth
curl -s http://rabbitmq:15672/api/queues/%2F/payments | jq '.messages'
```

## Anti-Patterns

- Runbooks that say "contact the team lead" as step 1
- Outdated commands that reference decommissioned infrastructure
- Missing runbooks for critical alerts

See [[perf-016]] for alerting and [[perf-023]] for incident management.
