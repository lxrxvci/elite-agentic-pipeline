# ADR 0003: Cookie-Based Sessions for Frontend Authentication

## Status

Accepted

## Context

The frontend originally stored the bearer token in `localStorage` after the dev `/auth/token` endpoint returned it. This pattern is convenient for SPAs but has a significant security downside: any XSS vulnerability allows an attacker to exfiltrate the token and impersonate the user.

Production identity is provided by Clerk OIDC/OAuth2, but the dev authentication flow still needs a secure session mechanism for local development and CI tests.

## Decision

We will use `httpOnly`, `Secure`, `SameSite=Strict` cookies for session tokens in both the dev authentication flow and future backend-issued sessions.

- The backend issues the session cookie on `/auth/token`.
- The backend reads the session cookie in `get_current_user` when no `Authorization` header is present.
- The frontend no longer persists tokens in `localStorage`.
- Frontend API requests use `credentials: 'include'` so cookies are sent cross-origin when needed.
- A logout endpoint clears the cookie.

## Consequences

- **Pros:**
  - Tokens are not accessible to JavaScript, mitigating XSS-based token theft.
  - Aligns with OWASP session management recommendations.
  - Works with Clerk-managed sessions (Clerk issues its own cookies) and the dev JWT flow.

- **Cons:**
  - Cookies require careful CORS configuration (`allow_credentials=True`, no wildcard origins).
  - CSRF protection must be considered for state-changing operations; we rely on `SameSite=Strict` and CORS for API requests.
  - Server-side rendering scenarios need to forward cookies on initial requests.

## Alternatives Considered

- Keep `localStorage` with CSP mitigations: rejected because CSP can be bypassed or misconfigured.
- Use Clerk session cookies only and remove dev JWT endpoint: deferred until Clerk is fully integrated in development workflows.

## References

- OWASP Session Management Cheat Sheet
- FastAPI `Response.set_cookie` documentation
