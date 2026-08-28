import { NextResponse, type NextRequest } from "next/server";

/**
 * Fast cookie-presence gate (ADR-0005). This is intentionally NOT a session
 * validation - DB-backed validation happens in server components / guards
 * (src/server/auth/guards.ts). The middleware only decides whether a login
 * round-trip is needed at all.
 *
 * Note: the (app) route group is invisible in the URL, so protection is
 * expressed by exclusion - everything except /login, /portal/login, the
 * auth API, and Next.js internals requires the session cookie.
 */
const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => request.cookies.has(name));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authed = hasSessionCookie(request);

  if (pathname === "/login") {
    if (authed) return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  // §12 portal sign-in: public like /login. Already-signed-in portal users
  // are bounced to /portal by the page itself (staff stay put - the portal
  // layout 404s staff roles).
  if (pathname === "/portal/login") {
    return NextResponse.next();
  }

  // Dev-only magic-link retrieval; the route itself refuses outside dev.
  if (pathname.startsWith("/portal/api/")) {
    return NextResponse.next();
  }

  if (!authed) {
    const isPortal = pathname === "/portal" || pathname.startsWith("/portal/");
    const login = new URL(isPortal ? "/portal/login" : "/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *  api/auth             (Better Auth endpoints - must be reachable while logged out)
     *  api/cron             (Vercel Cron - bearer-token guarded in the route)
     *  api/documents        (streamed downloads - role-guarded in the route)
     *  api/chat-attachments (streamed attachments - membership-guarded in the route)
     *  _next/*              (static assets, image optimizer)
     *  files with an extension (favicon.ico, etc.)
     */
    "/((?!api/auth|api/cron|api/documents|api/chat-attachments|_next|.*\\..*).*)",
  ],
};
