---
title: Behavior-Driven Development
tags: [bdd, testing, agile]
---

# Behavior-Driven Development

**BDD** extends TDD by writing tests in a natural language format that stakeholders can read. The goal is to bridge the gap between technical and business perspectives.

## Gherkin Syntax

BDD scenarios use the Given-When-Then structure:

```gherkin
Feature: Shopping Cart
  Scenario: Adding an item to the cart
    Given the cart is empty
    When I add a "Widget" costing $9.99
    Then the cart should contain 1 item
    And the cart total should be $9.99
```

## Frameworks

- **Cucumber** — the original, supports many languages
- **Jest-Cucumber** — integrates Gherkin with Jest
- **Playwright BDD** — combines e2e testing with BDD syntax

## The Collaboration Gap

BDD is most valuable when product managers and QA engineers actually read and contribute to the scenarios. Without that collaboration, Gherkin becomes ceremony without benefit. Many teams adopt BDD but never achieve the collaboration it promises.

The overhead of maintaining feature files alongside step definitions is significant. If only developers read the scenarios, plain test functions are simpler. See [[test-006]] for TDD and [[test-008]] for acceptance criteria.
