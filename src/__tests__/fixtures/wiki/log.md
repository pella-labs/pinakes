# Turn log

- turn 1: created `src/auth/login.ts` with `hashPassword()` using bcrypt cost factor 12
- turn 2: added tests for `hashPassword` edge cases (empty string, very long password, unicode)
- turn 3: wired the login handler through the MCP dispatcher and verified it returns 401 on bad credentials
- turn 4: switched the database layer to `better-sqlite3` with WAL mode after hitting writer contention in a load test
- turn 5: moved personal-scope data into a separate `~/.pharos/profile/kg.db` file to enforce the privacy boundary
- turn 6: added session revocation by writing to `sessions_revoked` instead of relying on JWT expiry alone
