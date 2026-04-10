# Testing Cryptographic Operations

Cryptographic code must be tested carefully. Incorrect implementations can silently produce insecure results.

## Hash Consistency

```typescript
it('produces consistent SHA-256 hash', () => {
  const input = 'hello world';
  const hash1 = sha256(input);
  const hash2 = sha256(input);
  expect(hash1).toBe(hash2);
  expect(hash1).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
});
```

## Encryption Roundtrip

```typescript
it('encrypts and decrypts correctly', () => {
  const key = generateKey();
  const plaintext = 'sensitive data';
  const encrypted = encrypt(plaintext, key);
  const decrypted = decrypt(encrypted, key);

  expect(decrypted).toBe(plaintext);
  expect(encrypted).not.toBe(plaintext);
});
```

## Key Derivation

Test that key derivation produces different keys for different salts and the same key for the same salt:

```typescript
it('produces different keys for different salts', () => {
  const key1 = deriveKey('password', 'salt1');
  const key2 = deriveKey('password', 'salt2');
  expect(key1).not.toBe(key2);
});
```

## Timing Attack Resistance

Password comparison must be constant-time. While hard to test deterministically, you can verify that the comparison function is used instead of `===`.

## Known-Answer Tests

Use test vectors from NIST or RFC documents to verify your implementation matches the standard.
