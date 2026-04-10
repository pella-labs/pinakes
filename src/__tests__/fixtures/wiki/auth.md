# Authentication

## Login flow

The login handler lives at `src/auth/login.ts`. It calls `hashPassword(raw, 12)`
which wraps `bcrypt.hashSync(raw, 12)` with a cost factor of 12.

The handler returns a signed JWT on success and a generic `401` on any kind of
failure — we deliberately do not distinguish between "unknown user" and "wrong
password" in the response, to avoid user enumeration.

## Password reset

Reset uses the same `hashPassword` utility from the login flow — we don't want
two password hashing paths.

The reset token is a random 32-byte value base64-encoded, stored hashed (again
via `hashPassword`) so that a leaked `password_resets` table doesn't give an
attacker live tokens.

## Session revocation

Sessions are opaque ids, not self-contained JWTs, specifically so we can revoke
them on logout or password change. Revocation writes a row to `sessions_revoked`
and subsequent requests bearing that session id get a `401`.
