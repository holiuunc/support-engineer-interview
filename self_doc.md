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
*   **Root Cause**: The application was initializing a new database connection for every operation without reusing or closing them. Leading to a rapid accumulation of open file handles and potential memory leaks, eventually causing the application or database to crash under load.
*   **Fix Implementation**: Implemented a Singleton pattern for the database connection in `lib/db/index.ts`. The `getSqliteConnection` function now checks if a connection already exists and returns it, ensuring only one db instance is active for the application's lifecycle. We added `closeDb` function and process signal handlers (`SIGINT`, `SIGTERM`) to close the connection on shutdown. Removed unused `connections` array that was previously tracking these instances.
*   **Preventive Measures**: 
    *   Utilize connection pooling or singleton patterns for shared resources like database connections.
    *   Implement application lifecycle hooks to handle graceful shutdowns.
    *   Monitor open file handles and memory usage during load testing through proper logging.

### SEC-302: Insecure Random Numbers
*   **Root Cause**: Account numbers were being generated using `Math.random()`. This is a number generator that's pseudo-random and not cryptographically secure, making the generated numbers potentially predictable and susceptible to collision or guessing attacks.
*   **Fix Implementation**: Replaced `Math.random()` with `crypto.randomInt()` (from the Node.js built-in `crypto` module) in `server/routers/account.ts`. This uses a Cryptographically Secure Pseudo-Random Number Generator backed by the operating system's entropy pool, to ensure a non-deterministic randomness for the generated numbers.
*   **Preventive Measures**:
    *   Use `crypto` module or equivalent CSPRNGs for any security-sensitive value generation (tokens, IDs, passwords).

### SEC-303: XSS Vulnerability
*   **Root Cause**: The `TransactionList` component was using `dangerouslySetInnerHTML` to render transaction descriptions. This bypasses React's built-in XSS protection, allowing malicious scripts injected into the description field to execute in the user's browser.
*   **Fix Implementation**: Removed the usage of `dangerouslySetInnerHTML` in `components/TransactionList.tsx`. The description is now rendered as standard JSX text content, which React automatically escapes, rendering any HTML tags as literal text rather than executing them.
*   **Preventive Measures**:
    *   Avoid `dangerouslySetInnerHTML` unless strictly necessary.
    *   If HTML rendering is required, always sanitize the input using a library like `DOMPurify` before rendering.
    *   Conduct code reviews focusing on frontend security/rendering paths to prevent needing to use `dangeroouslySetInnerHTML`.

### VAL-208: Weak Password Requirements
*   **Root Cause**: The previous password validation only enforced a minimum length of 8 characters. This allowed users to set weak, easily guessable passwords ("password123"), making accounts vulnerable to brute-force and dictionary attacks.
*   **Fix Implementation**: 
    *   Updated `server/routers/auth.ts` and `app/signup/page.tsx` to use `zod` for schema validation.
    *   Enforced stricter requirements: at least 8 characters, 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.
    *   Integrated `zxcvbn` library to calculate password entropy and enforce a minimum complexity score of 3/4, rejecting technically "compliant" but weak passwords.
*   **Preventive Measures**:
    *   Use password strength estimation libraries (like `zxcvbn`) rather than just arbitrary rules.
    *   Provide real-time feedback to users on password strength during registration.

### SEC-301: SSN Storage (Plaintext)
*   **Root Cause**: Social Security Numbers were stored in the database as plaintext strings, HUGE NONO. This is a critical security failure, exposing sensitive PII directly in the event of a database dump or unauthorized access.
*   **Fix Implementation**:
    *   Implemented AES-256-GCM encryption in `lib/crypto/encryption.ts` as utility functions.
    *   Updated `server/routers/auth.ts` to encrypt the SSN before storing it in the database.
    *   The system now requires an `ENCRYPTION_KEY` environment variable (put in `.env.local`).
    *   *Note*: We're treating this as a "new" system scenario, no migration script was created for existing data, but one would be required for a production fix.
*   **Preventive Measures**:
    *   Never store Personally Identifiable Information in plaintext.
    *   Use field-level encryption for sensitive columns.
    *   Implement strict access controls and auditing for database access.








[TEMPLATE]
### TICK-NUM: Desc
*   **Root Cause**: [FILL]
*   **Fix Implementation**: [FILL]
*   **Preventive Measures**: 
    *   [FILL]