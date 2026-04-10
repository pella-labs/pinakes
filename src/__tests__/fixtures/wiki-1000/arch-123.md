# Architecture Anti-Patterns

## Distributed Monolith

Microservices that must be deployed together, share databases, and break when one goes down. All the costs of distributed systems with none of the benefits.

## Big Ball of Mud

No discernible architecture. Everything depends on everything. Change one thing, break three others.

## Golden Hammer

"We use Kafka for everything" — even when a simple HTTP call or database trigger would suffice.

## Premature Optimization

Designing for 1M users when you have 100. Build for current scale, design for 10x, plan for 100x.

## Resume-Driven Development

Choosing technologies because they look good on a resume rather than because they solve the problem.

## Cargo Culting

"Netflix does it this way" — Netflix also has 10,000 engineers. Context matters.

## Accidental Complexity

Complexity that exists because of technical choices, not business requirements. Every line of code is a liability.

See [[arch-001]], [[arch-002]], [[arch-025]].
