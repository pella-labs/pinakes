# On-Call Best Practices

## Sustainable On-Call

On-call should not be heroic. If on-call engineers are consistently sleep-deprived or overwhelmed, the system has reliability problems that need engineering investment, not human sacrifice.

## On-Call Structure

- **Rotation**: 1 week on, 3+ weeks off minimum
- **Primary + secondary**: always have a backup
- **Escalation path**: clear chain when the primary can't resolve
- **Handoff**: structured handoff at rotation boundaries

## During an Incident

1. Acknowledge the page within 5 minutes
2. Assess severity and communicate
3. Follow the runbook if one exists
4. Escalate if you can't resolve within 30 minutes
5. Document the timeline as you go

## Reducing Toil

Track on-call burden metrics:

- Pages per shift
- Time to acknowledge
- Time to resolve
- Percentage of actionable alerts
- Sleep interruptions

If pages per shift average more than 2, invest in reliability improvements or alert tuning.

## Compensation

On-call engineers should be compensated. Whether through extra pay, time off, or other means, acknowledging the burden is essential for retention.

See [[perf-016]] for alerting and [[perf-022]] for runbooks.
