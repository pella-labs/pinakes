# Acceptance Criteria and Testing

**Acceptance criteria** define when a feature is done. They bridge product requirements and test cases, giving developers clear targets and QA engineers clear verification steps.

## Writing Good Acceptance Criteria

Effective acceptance criteria are:

- Specific enough to test
- Independent of implementation
- Written from the user's perspective
- Verifiable without subjective judgment

### Example

**User story**: As a subscriber, I want to filter my invoices by date range.

**Acceptance criteria**:
1. The filter shows a date range picker with start and end fields
2. Results update within 2 seconds of applying the filter
3. An empty date range shows all invoices
4. Invalid date ranges show an error message
5. The filter persists across page navigation

## From Criteria to Tests

Each acceptance criterion maps to one or more test cases. Criterion 2 becomes a performance test. Criterion 4 becomes an error handling test. Criterion 5 becomes a state management test.

## Definition of Done

Acceptance criteria are part of the broader **definition of done** which might also include code review, documentation, and deployment requirements. See [[test-007]] for how BDD formalizes this mapping.
