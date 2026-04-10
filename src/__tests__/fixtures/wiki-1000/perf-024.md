---
title: Blameless Post-Mortems
tags: [incidents, postmortems, culture]
created: 2025-10-20
---
# Blameless Post-Mortems

## The Blameless Principle

People do not cause incidents; systems allow incidents to happen. A **blameless post-mortem** focuses on systemic improvements rather than individual fault. If someone made a mistake, the question is: why did the system allow that mistake to have that impact?

## Post-Mortem Template

### Summary
One paragraph describing what happened, when, and the user impact.

### Timeline
Minute-by-minute account from detection to resolution. Include who did what and when.

### Root Cause Analysis
Use the **5 Whys** technique to dig past the surface cause.

### Contributing Factors
What else made this incident worse or harder to resolve? Missing documentation? Slow alerting? No rollback mechanism?

### Action Items
Every action item must have an owner and a due date. Categories:

- **Prevent**: changes that stop this exact failure mode
- **Detect**: changes that catch this earlier
- **Mitigate**: changes that reduce impact when it happens again

### Lessons Learned
What went well? What didn't? What was lucky?

## Follow-Through

Schedule a review 30 days after the post-mortem to verify action items are completed. Unfinished action items from post-mortems are the strongest signal of reliability culture debt.

See [[perf-023]] for incident management and [[perf-020]] for SLOs.
