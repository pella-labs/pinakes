# Incident Management Process

## Incident Lifecycle

### Detection
Incidents are detected through monitoring alerts, user reports, or automated health checks. The faster detection happens, the lower the impact.

### Triage
Assign a severity level and an **incident commander** (IC). The IC is responsible for coordinating response, not for fixing the issue personally.

### Response
The IC assembles a response team, establishes a communication channel, and delegates diagnostic work. Communication cadence depends on severity:

- P1: updates every 15 minutes
- P2: updates every 30 minutes
- P3: updates every 2 hours

### Resolution
Once the root cause is identified, implement and verify the fix. Communicate resolution to stakeholders.

### Post-Incident
Conduct a blameless post-mortem within 48 hours.

## Incident Commander Responsibilities

- Declare incident severity
- Open and manage the incident channel
- Coordinate between teams
- Communicate status to stakeholders
- Ensure someone is writing the timeline
- Call for additional help when needed
- Declare the incident resolved

## Communication Templates

Use pre-written templates for status updates to reduce cognitive load during incidents. Templates should cover: what's happening, who's affected, what we're doing, when the next update is.

See [[perf-024]] for post-mortem practices.
