# Accessibility Testing

**Accessibility testing** verifies that software is usable by people with disabilities. It covers screen readers, keyboard navigation, color contrast, and semantic HTML.

## Automated Testing

Tools like **axe-core** can catch about 30-40% of accessibility issues automatically:

```typescript
import { axe } from 'jest-axe';

test('login page has no accessibility violations', async () => {
  const { container } = render(<LoginPage />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

## WCAG Compliance Levels

- **Level A**: Minimum compliance, covers critical barriers
- **Level AA**: Standard target for most organizations
- **Level AAA**: Highest standard, difficult to achieve fully

## Key Areas to Test

- Keyboard navigation (Tab order, focus management)
- Screen reader compatibility (ARIA labels, semantic HTML)
- Color contrast ratios (4.5:1 for normal text)
- Text alternatives for images
- Form field labels and error messages
- Motion and animation preferences

## Manual Testing

Automated tools miss context-dependent issues. Regular manual testing with actual assistive technology is essential. Have team members navigate the app using only a keyboard or only a screen reader.

## CI Integration

Run axe-core in CI on every pull request. Treat violations as build failures for Level A and warnings for Level AA. This prevents accessibility regressions from being introduced.
