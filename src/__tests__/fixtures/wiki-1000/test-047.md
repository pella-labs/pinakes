# Testing Email Sending

Email sending should never happen accidentally in tests. Capture outbound emails and verify their content.

## Email Capture Patterns

### In-Memory Transport

```typescript
const sentEmails: Email[] = [];
const transport = {
  send: async (email: Email) => {
    sentEmails.push(email);
  },
};

it('sends welcome email on signup', async () => {
  await signup({ email: 'new@test.com' }, transport);
  expect(sentEmails).toHaveLength(1);
  expect(sentEmails[0].to).toBe('new@test.com');
  expect(sentEmails[0].subject).toContain('Welcome');
});
```

### SMTP Test Server

Tools like **MailHog** or **Ethereal** provide test SMTP servers that capture emails without delivering them.

## What to Verify

- Recipient addresses (to, cc, bcc)
- Subject line content
- Body contains expected text or links
- Attachments are present and correct
- Template variables are substituted
- Unsubscribe links are included

## Preventing Accidental Sends

Configure your test environment to use a transport that throws if a real SMTP server is configured. This catches configuration errors where tests would send real emails.

```typescript
if (process.env.NODE_ENV === 'test' && config.smtp.host !== 'localhost') {
  throw new Error('Real SMTP configured in test environment!');
}
```
