# Steps taken

- First had Claude reorganize provided tasks in order of system impact and dependency

- Completed UI-101 as exploratory issue but also as means of fixing up UI so we can see text to test properly.
    - added tailwind conventional `dark:` variant pattern to existing text bodies
    - there is a more code efficient method of doing this, however, in order to follow convention and have a better time debugging in the future, we'll go with this implemented approach
### UI-101: Dark Mode Text Visibility
*   **Root Cause**: Lack of `dark:` variant to address user preferences when they're using a system preference for light/dark, causing a inconsistencies with color and background, thus some components are hard to see (accessibility issue).
*   **Fix Implementation**: added tailwind conventional `dark:` variant pattern to existing components where these issues occur (dashboard, login, account-creation, any forms etc)
*   **Preventive Measures**: 
    *   Refactor to a design system or centralized theme configuration (e.g., using CSS variables for semantic colors like `--bg-primary`, `--text-primary`) to automatically handle theme switching without manually adding `dark:` utility classes to every element.
        *   Due to time, we just went with Tailwind conventional classNames.
    *   Taking WCAG contrast ratio measurements to ensure that we follow guidelines for proper contrast ratios with Lighthouse tests on each component/view.
    *   Establish a development protocol requiring manual verification of UI components in both themes before merging.


## Critical Issues

### PERF-408: Resource Leak (Database Connections)
*   **Root Cause**: The application was initializing a new database connection for every operation without reusing or closing them. This led to a rapid accumulation of open file handles and potential memory leaks, eventually causing the application or database to crash under load.
*   **Fix Implementation**: 
    *   Implemented a Singleton pattern for the database connection in `lib/db/index.ts`.
    *   **Technical Detail**: Utilized the `globalThis` object to store the active connection instance. This ensures that the database connection persists across Next.js module reloads (Fast Refresh) in development, preventing "database locked" errors and connection leaks that occur when modules are re-executed.
    *   Added `closeDb` function and process signal handlers (`SIGINT`, `SIGTERM`) to gracefully close the connection on shutdown.
    *   Removed the unused `connections` array.
*   **Preventive Measures**: 
    *   Utilize connection pooling or singleton patterns for shared resources like database connections.
    *   Implement application lifecycle hooks to handle graceful shutdowns.
    *   Monitor open file handles and memory usage during load testing.

### SEC-302: Insecure Random Numbers
*   **Root Cause**: Account numbers were being generated using `Math.random()`. This is a pseudo-random number generator (PRNG) that is not cryptographically secure, making the generated numbers potentially predictable and susceptible to collision or guessing attacks.
*   **Fix Implementation**: Replaced `Math.random()` with `crypto.randomInt()` (from the Node.js built-in `crypto` module) in `server/routers/account.ts`. This uses a Cryptographically Secure Pseudo-Random Number Generator (CSPRNG) backed by the operating system's entropy pool, ensuring high entropy and unpredictability.
*   **Preventive Measures**:
    *   Use `crypto` module or equivalent CSPRNGs for any security-sensitive value generation (tokens, IDs, passwords).
    *   Enforce linting rules (e.g., `eslint-plugin-security`) to flag `Math.random()` usage in backend code.

### SEC-303: XSS Vulnerability
*   **Root Cause**: The `TransactionList` component was using `dangerouslySetInnerHTML` to render transaction descriptions. This bypasses React's built-in XSS protection, allowing malicious scripts injected into the description field to execute in the user's browser.
*   **Fix Implementation**: Removed the usage of `dangerouslySetInnerHTML` in `components/TransactionList.tsx`. The description is now rendered as standard JSX text content, which React automatically escapes, rendering any HTML tags as literal text rather than executing them.
*   **Preventive Measures**:
    *   Avoid `dangerouslySetInnerHTML` unless strictly necessary.
    *   If HTML rendering is required, always sanitize the input using a library like `DOMPurify` before rendering.
    *   Conduct code reviews focusing on frontend security/rendering paths.

### VAL-208: Weak Password Requirements
*   **Root Cause**: The previous password validation only enforced a minimum length of 8 characters. This allowed users to set weak, easily guessable passwords (e.g., "password123", "12345678"), making accounts vulnerable to brute-force and dictionary attacks.
*   **Fix Implementation**: 
    *   Updated `server/routers/auth.ts` and `app/signup/page.tsx` to use `zod` for schema validation.
    *   Enforced stricter requirements: at least 8 characters, 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.
    *   Integrated `zxcvbn` library to calculate password entropy and enforce a minimum complexity score of 3/4, rejecting technically "compliant" but weak passwords.
    *   **Optimization**: Replaced the heavy default `zxcvbn` package with the modular `@zxcvbn-ts/core` and `@zxcvbn-ts/language-common` to significantly reduce the client-side bundle size.
    *   **Technical Consideration**: Implemented the `zxcvbn` configuration within a `useEffect` hook in `app/signup/page.tsx`. This ensures the library options are initialized only once on the client-side after mounting, following React best practices for handling global side effects in Next.js components and avoiding potential hydration mismatches or redundant processing during renders.
*   **Preventive Measures**:
    *   Adopt NIST SP 800-63B guidelines for digital identity.
    *   Use password strength estimation libraries (like `zxcvbn`) rather than just arbitrary rules.
    *   Provide real-time feedback to users on password strength during registration.

### SEC-301: SSN Storage (Plaintext)
*   **Root Cause**: Social Security Numbers (SSNs) were stored in the database as plaintext strings. This is a critical security failure, exposing sensitive PII directly in the event of a database dump or unauthorized access.
*   **Fix Implementation**:
    *   Implemented AES-256-GCM encryption in `lib/crypto/encryption.ts` as utility functions, caching the encryption key parsing for performance.
    *   **Uniqueness Fix**: Introduced a **Blind Index** strategy. Added a `ssnHash` column to the schema and implemented a `hashSSN` function using HMAC-SHA256 with a separate PEPPER. This allows us to enforce uniqueness constraints on the SSN (by checking the hash) without exposing the actual SSN or using weak deterministic encryption.
    *   Updated `server/routers/auth.ts` to generate the hash for uniqueness checks and encrypt the payload for storage.
    *   The system now requires `ENCRYPTION_KEY` and optional `SSN_PEPPER` environment variables.
    *   *Note*: As this is a "new" system scenario, no migration script was created for existing data, but one would be required for a production fix.
*   **Preventive Measures**:
    *   Never store PII (Personally Identifiable Information) in plaintext.
    *   Use field-level encryption for sensitive columns.
    *   Implement strict access controls and auditing for database access.

## Tier 2: Critical Business Logic Issues

### PERF-406: Balance Calculation Errors
*   **Root Cause**: Two critical issues in the `fundAccount` mutation:
    1. **Floating-point arithmetic loop**: Lines 134-137 added `amount / 100` in a loop 100 times, introducing cumulative floating-point precision errors making balances inaccurate.
    2. **Race condition**: The code read `account.balance`, then calculated `account.balance + amount` in JS, then updated the database. If two concurrent requests occurred, both would read the same initial balance, and one update would be lost.
*   **Fix Implementation**:
    *   Removed the erroneous floating-point loop entirely.
    *   Implemented **atomic SQL-level update** using Drizzle ORM's `sql` template: `balance = ${accounts.balance} + ${amount}`. This ensures the database performs the addition atomically, eliminating race conditions.
    *   Fetch the updated account after the balance update to return the accurate new balance to the client.
    *   Fixed transaction fetching to query by account ID for accuracy.
*   **Preventive Measures**:
    *   For financial calculations, always use database-level atomic operations (`UPDATE SET balance = balance + ?`) rather than read-modify-write patterns.
    *   Avoid floating-point arithmetic loops for monetary values; use precise decimal types or integer cents.
    *   Implement database transactions with proper isolation levels for critical financial operations.
    *   Add concurrency tests that simulate simultaneous balance updates to catch race conditions early.

### PERF-401: Account Creation Error (Fallback Balance)
*   **Root Cause**: The `createAccount` mutation had a fallback object (lines 58-68) that returned fake account data with `balance: 100` when the database fetch failed after insertion. This masked critical errors by displaying incorrect information to users instead of reporting the failure.
*   **Fix Implementation**:
    *   Removed the entire fallback object.
    *   Added proper error handling: if the account fetch fails after insertion, throw a `TRPCError` with code `INTERNAL_SERVER_ERROR` and message "Account created but failed to retrieve details".
    *   **Concurrency Fix**: Refactored the account number generation to use an **Optimistic Retry Loop**. Instead of checking for existence first, the code now attempts to insert the record directly. If a unique constraint violation (collision) occurs, it catches the specific SQL error and retries (up to 5 times). This is significantly more robust and performant than the previous race-prone "check-then-insert" pattern.
*   **Preventive Measures**:
    *   Never use fallback/default objects to mask database or system errors in critical operations.
    *   Use optimistic concurrency control (try/catch on insert) for unique constraint generation rather than checking for existence first.
    *   Always throw proper errors when operations fail, allowing the client to handle them appropriately.
    *   Implement comprehensive error logging to track when database operations partially succeed.
    *   Use database transactions to ensure atomicity - if account retrieval fails, roll back the creation.

### SEC-304: Session Management (Multiple Sessions)
*   **Root Cause**: The `login` mutation created new sessions without invalidating existing ones. Users could log in from multiple devices indefinitely, with all sessions remaining active. This creates a security risk where compromised old sessions can still access the account even after logging in from a new device.
*   **Fix Implementation**:
    *   Added session invalidation before creating the new session: `await db.delete(sessions).where(eq(sessions.userId, user.id))`.
    *   This ensures that when a user logs in, ALL previous sessions for that user are deleted from the database.
    *   Only the most recent login session remains valid.
    *   **Behavior**: Old devices will NOT be immediately logged out (cookies still exist client-side), but the next time they make ANY protected API call, the middleware will find no matching session in the database and return UNAUTHORIZED, forcing re-login.
*   **Preventive Measures**:
    *   For banking/financial applications, single-session-per-user is the recommended security pattern.
    *   Implement session monitoring and alerts for unusual login patterns.
    *   Add "active sessions" UI so users can see where they're logged in.
    *   Consider adding a "logout all devices" feature for user-initiated session cleanup.

### PERF-403: Session Expiry Issues
*   **Root Cause**: The session validation in `server/trpc.ts` used `new Date(session.expiresAt) > new Date()`, which meant sessions were valid until the exact millisecond of expiry. This creates a security edge case where sessions on the verge of expiring (e.g., last 5 seconds) could still be used, potentially allowing unauthorized access if the session was compromised near expiry.
*   **Fix Implementation**:
    *   Added a 60-second buffer before the actual expiry time: `const EXPIRY_BUFFER_MS = 60000`.
    *   Sessions now expire 1 minute before their database `expiresAt` timestamp.
    *   Changed validation logic to: `if (timeUntilExpiry > EXPIRY_BUFFER_MS)`, ensuring sessions are rejected if less than 1 minute remains.
    *   This provides a safety margin and prevents edge-case security issues.
*   **Preventive Measures**:
    *   Always implement expiry buffers for security-critical tokens and sessions.
    *   Consider implementing token refresh mechanisms for better UX (refresh before expiry).
    *   Add client-side session expiry warnings to notify users before automatic logout.
    *   Use stricter comparison operators (`>=` instead of `>`) when dealing with time-based security checks.

### PERF-402: Logout Issues
*   **Root Cause**: The `logout` mutation always returned `success: true` regardless of whether the session was actually deleted from the database. Token extraction could fail silently, and there was no verification that the database deletion succeeded. Users might believe they were logged out when their session remained active.
*   **Fix Implementation**:
    *   Added session deletion verification: before deleting, check if the session exists; after deleting, verify it's gone.
    *   Track deletion success with `sessionDeleted` boolean flag.
    *   Return accurate status: `success: sessionDeleted || !token` (success if deleted OR no session to delete).
    *   Provide specific messages: "Logged out successfully", "No active session", or "Logout failed - session may still be active".
    *   Cookie is always cleared for security, even if database deletion fails.
*   **Preventive Measures**:
    *   Always verify critical operations (like logout) succeeded before reporting success.
    *   Add comprehensive logging for authentication operations to track failures.
    *   Implement health checks that verify session cleanup is working properly.
    *   Consider implementing session cleanup background jobs to remove stale sessions.

[TEMPLATE]
### TICK-NUM: Desc
*   **Root Cause**: [FILL]
*   **Fix Implementation**: [FILL]
*   **Preventive Measures**: 
    *   [FILL]