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

## Tier 3: High-Priority Validation & Performance Issues

### PERF-407: Transaction Query Optimization (N+1 Query)
*   **Root Cause**: The `getTransactions` query in `server/routers/account.ts` had an N+1 query problem. After fetching all transactions for an account, the code looped through each transaction and re-fetched the same account details from the database. This caused exponential database load and potential timeouts.
*   **Fix Implementation**:
    *   Removed the `for` loop that re-queried the database for each transaction.
    *   Reference the already-fetched `account` object from the initial ownership verification query.
    *   Replaced the loop with a `.map()` operation that merges the account type in memory.
    *   We reduced query count from O(n+1) to exactly 2 queries regardless of transaction count.
*   **Preventive Measures**:
    *   Always review queries for N+1 patterns - watch for loops that make database calls.
    *   Use ORM features like `include`/`join` or pre-fetch related data instead of querying in loops.
    *   Add database query monitoring and alerting for excessive query counts.
    *   Implement performance testing with realistic data volumes to catch scaling issues early.

### PERF-404: Transaction Sorting
*   **Root Cause**: The `getTransactions` query returned transactions in insertion order (or undefined order), making the UI confusing as older transactions could appear at the top of the list.
*   **Fix Implementation**:
    *   Added `.orderBy(desc(transactions.createdAt), desc(transactions.id))` to the query in `server/routers/account.ts`.
    *   Imported `desc` from `drizzle-orm`.
    *   Uses **dual-key sorting**: primary sort by timestamp, secondary sort by ID for deterministic ordering when multiple transactions have identical timestamps.
    *   Transactions now return in reverse chronological order (newest first), providing a better user experience.
*   **Preventive Measures**:
    *   Always explicitly specify sort order for queries, never rely on insertion order.
    *   Use secondary sort keys (like ID) when primary key (like timestamp) may have duplicates.
    *   Include sorting requirements in API design specifications.

### PERF-405: Missing Transactions
*   **Root Cause**: Investigation revealed this was a symptom of PERF-407 and PERF-404 (lack of sorting). The N+1 query caused timeouts or incomplete responses on large datasets, while the lack of sorting made transactions difficult to locate in the UI, giving the appearance of missing data.
*   **Fix Implementation**:
    *   Resolved by fixing PERF-407 (removing N+1 query) and PERF-404 (adding sorting).
    *   The underlying issues causing data loss and UI confusion are now eliminated.
    *   No additional changes were necessary beyond the N+1 and sorting fixes.
*   **Preventive Measures**:
    *   Investigate root causes rather than treating symptoms.
    *   Test with realistic data volumes (50+ transactions) to catch performance issues.
    *   Implement query timeouts and monitoring to detect performance degradation early.

### VAL-202: Date of Birth Validation
*   **Root Cause**: The signup form accepted any date string without validation, allowing users to enter future dates or dates indicating they are under 18 years old, creating compliance risks for a financial application.
*   **Fix Implementation**:
    *   Created shared `calculateAge()` utility function in `lib/utils.ts` (server) and `lib/client-utils.ts` (client) that properly handles month/day edge cases.
    *   **Server-side** (`server/routers/auth.ts`): Added single `.refine()` validation using `calculateAge(dob) >= 18`. This elegantly handles both future dates (returns negative age) and underage users.
    *   **Client-side** (`app/signup/page.tsx`): Added single `validate` function using `calculateAge(value) >= 18`, matching server implementation and providing immediate feedback.
    *   Age calculation properly handles edge cases where birthday hasn't occurred yet this year.
*   **Preventive Measures**:
    *   Always validate age-restricted services at both client and server levels.
    *   Use shared utility functions to ensure consistent validation logic across frontend and backend.
    *   For financial applications, implement KYC (Know Your Customer) age verification.
    *   Consider adding ID verification for age-restricted services.
    *   Document edge cases and limitations (e.g., timezone considerations) in code comments.

### VAL-206: Card Number Validation (Luhn Algorithm)
*   **Root Cause**: Card number validation only checked length (16 digits), not validity. This allowed invalid card numbers to be submitted, causing failed payment processing and poor user experience.
*   **Fix Implementation**:
    *   Created `lib/utils/validation.ts` with a reusable `isValidLuhn()` function implementing the Luhn algorithm for credit card validation.
    *   **Server-side** (`server/routers/account.ts`): Added `.refine()` to `fundingSource` schema that validates card numbers using Luhn algorithm.
    *   **Client-side** (`components/FundingModal.tsx`): Added Luhn validation to provide immediate feedback before submission.
    *   Updated pattern validation to accept 15-16 digits (to support both standard cards and Amex).
*   **Preventive Measures**:
    *   Always use industry-standard validation algorithms for financial data (Luhn for cards, ABA routing checksums, etc.).
    *   Implement validation on both client (UX) and server (security) sides.
    *   Use shared utility functions to ensure consistency across frontend and backend.

### VAL-207: Routing Number Required for Bank Transfers
*   **Root Cause**: The `routingNumber` field was marked as optional for all funding types, allowing bank transfers to be submitted without a routing number, causing ACH transfer failures.
*   **Fix Implementation**:
    *   Added conditional `.refine()` validation to the `fundingSource` schema in `server/routers/account.ts`.
    *   If `type === "bank"`, the refine enforces that `routingNumber` exists and matches the 9-digit format (`/^\d{9}$/`).
    *   Card transactions can omit the routing number as expected.
    *   **Note**: Routing number remains `.optional()` at the schema level because it's not required for card transactions; the `.refine()` enforces it conditionally.
*   **Preventive Measures**:
    *   Use conditional validation (Zod `.refine()`) for fields that are required based on other field values.
    *   Consider splitting schemas for different use cases (card vs bank) to make requirements explicit.
    *   Add integration tests that verify all required fields for different transaction types.

### VAL-201: Email Validation
*   **Root Cause**: The ticket raised two concerns: (1) emails are converted to lowercase without notification, and (2) no validation for TLD typos like ".con" instead of ".com".
*   **Fix Implementation**:
    *   **Uppercase conversion**: Determined this is **intentional and correct** behavior following RFC 5321 standards and industry best practices. Email addresses are case-insensitive in practice, and every major service (Gmail, Facebook, etc.) normalizes to lowercase without notification. Existing `.toLowerCase()` behavior maintained.
    *   **Domain typo validation**: Implemented blocklist for common domain misspellings on both client and server.
    *   **Server-side** (`server/routers/auth.ts`): Added `.refine()` to email schema that blocks common typos: `gnail.com`, `gmil.com`, `yaho.com`, `hotmial.com`, `outlok.com`.
    *   **Client-side** (`app/signup/page.tsx`): Added `validate` function checking the same domain blocklist with helpful error message: "Invalid email domain. Did you mean gmail.com, yahoo.com, etc?".
    *   **Design Decision**: Did not implement comprehensive TLD validation due to 1000+ valid TLDs and constant growth. Focused on blocking common typos rather than validating all possible TLDs to avoid false positives.
*   **Preventive Measures**:
    *   Follow industry standards (RFCs) for email handling rather than creating custom behaviors.
    *   Rely on well-tested validation libraries (Zod, validator.js) for common formats.
    *   Use targeted blocklists for known typos rather than attempting comprehensive TLD validation.
    *   Consider extracting blocked domain list to configuration constant for easier maintenance.
    *   If enhanced email validation is needed in the future, consider email verification workflows (send confirmation email) rather than format validation.

### VAL-205: Zero Amount Funding
*   **Root Cause**: The amount validation used `.positive()` which accepts values > 0, including very small fractional amounts like `0.00001` that are impractical for currency transactions.
*   **Fix Implementation**:
    *   Changed `amount: z.number().positive()` to `amount: z.number().min(0.01, "Amount must be at least $0.01")` in `server/routers/account.ts`.
    *   This enforces a practical minimum of 1 cent for transactions.
*   **Preventive Measures**:
    *   Use explicit min/max constraints for currency fields rather than generic validators.
    *   Consider using integer cents (e.g., storing 100 for $1.00) to avoid floating-point precision issues.
    *   Define business rules for minimum transaction amounts in requirements documentation.

### VAL-210: Card Type Detection
*   **Root Cause**: Card validation only checked if the number started with 4 (Visa) or 5 (Mastercard), rejecting valid Amex and Discover cards.
*   **Fix Implementation**:
    *   Created comprehensive card type detection in `lib/utils/validation.ts`:
        *   `detectCardType()`: Detects card type based on proper prefix ranges (Visa: 4, Mastercard: 51-55 & 2221-2720, Amex: 34/37, Discover: 6011, 622126-622925, 644-649, 65)
        *   `isValidCardType()`: Returns true if card matches a known type
    *   Updated `components/FundingModal.tsx` to use card type detection and accept 15-16 digit cards (for Amex support).
    *   Validation now checks card type before running Luhn algorithm.
*   **Preventive Measures**:
    *   Use industry-standard card BIN (Bank Identification Number) ranges for validation.
    *   Keep card prefix definitions in a maintainable, well-documented location.
    *   Test with real test card numbers from major networks (available from payment processors).
    *   Update card prefixes when networks introduce new BIN ranges.

## Tier 4: Medium-Priority Enhancements

### VAL-203: State Code Validation
*   **Root Cause**: The signup form accepted any 2-character string for the state field (e.g., "XX", "ZZ"), allowing invalid state codes to be stored in the database. The validation only checked length, not whether the code was a valid US state.
*   **Fix Implementation**:
    *   Created `lib/constants.ts` to store application-level constants including `US_STATES` array with all 50 US state codes.
    *   Exported `USState` type for TypeScript type safety: `type USState = typeof US_STATES[number]`.
    *   **Server-side** (`server/routers/auth.ts`): Changed `state: z.string().length(2).toUpperCase()` to `state: z.enum(US_STATES)`.
    *   **Client-side** (`app/signup/page.tsx`): Updated `SignupFormData` type to use `state: USState` instead of `state: string`.
    *   Zod enum provides O(1) validation performance and strict TypeScript typing (`"AL" | "AK" | ... | "WY"` instead of `string`).
*   **Preventive Measures**:
    *   Use enum validation for fixed sets of values rather than pattern matching.
    *   Store validation constants in a centralized location (`lib/constants.ts`) for reusability.
    *   Consider dropdown select UI instead of text input for state selection to prevent user errors.

### VAL-204: Phone Number Format (E.164 Standard)
*   **Root Cause**: The signup form accepted any 10-15 digit string for phone numbers without standardization. This caused inconsistent storage formats and didn't handle user-friendly inputs with formatting (e.g., "(123) 456-7890", "123-456-7890"). Non-US numbers were stored inconsistently.
*   **Fix Implementation**:
    *   **Server-side** (`server/routers/auth.ts`): Implemented multi-step transformation using Zod:
        *   `.transform((val) => val.replace(/\D/g, ''))` - Strip all non-numeric characters (parentheses, dashes, spaces)
        *   `.refine((digits) => digits.length === 10, "Phone number must be 10 digits")` - Validate 10 digits for US numbers
        *   `.transform((digits) => \`+1${digits}\`)` - Convert to E.164 format with +1 country code
    *   **Client-side** (`app/signup/page.tsx`): Added `onChange` handler to strip non-numeric characters as the user types, limiting to 10 digits.
    *   All phone numbers now stored consistently as E.164 format (e.g., "+11234567890").
*   **Note**: Currently we only have support for US numbers, adding support for international numbers is not hard however since we're strictly checking for state codes via our other ticket, I'm making an assumption now due to lack of access to an engineer/creator of the ticket.
*   **Preventive Measures**:
    *   Always use international standards (E.164 for phone numbers) for data storage.
    *   Sanitize user input on both client (UX) and server (security) sides.
    *   Display formatted phone numbers to users while storing normalized E.164 internally.
    *   Document the expected format in API specifications and database schema comments.

### VAL-209: Amount Input Leading Zeros
*   **Root Cause**: The funding modal's amount validation regex `/^\d+\.?\d{0,2}$/` accepted numbers with multiple leading zeros (e.g., "00123.45", "001.50"), which is confusing and unprofessional for financial inputs.
*   **Fix Implementation**:
    *   Updated the regex pattern in `components/FundingModal.tsx` from `/^\d+\.?\d{0,2}$/` to `/^(?:0|[1-9]\d*)(?:\.\d{0,2})?$/`.
    *   **Regex Explanation**:
        *   `^(?:0|[1-9]\d*)` - Either exactly "0" OR a non-zero digit followed by any number of digits (prevents leading zeros)
        *   `(?:\.\d{0,2})?` - Optional decimal point with 0-2 digits for cents
    *   **Valid inputs**: "0", "0.05", "123.45", "1000.00"
    *   **Invalid inputs**: "00123.45", "001.50", "00"
    *   Single-line change with zero bundle size impact.
*   **Preventive Measures**:
    *   Use precise regex patterns that match business requirements for financial inputs.
    *   For enhanced UX, consider implementing ATM-style input (right-to-left backfill) in future iterations.
    *   Test edge cases: single zero, decimal-only amounts, large numbers, and invalid formats.
    *   Consider using controlled components with state management for more complex input formatting needs.