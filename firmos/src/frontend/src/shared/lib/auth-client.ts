"use client";

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields, magicLinkClient, twoFactorClient } from "better-auth/client/plugins";

import type { auth } from "@/server/auth/config";

/**
 * Browser-side Better Auth client (ADR-0005). Used by the login form, the
 * security-settings page, the top-bar sign-out, and the portal magic-link
 * sign-in (HANDOFF §12). Additional-field types are inferred from the server
 * config so `session.user.role` etc. typecheck.
 */
export const authClient = createAuthClient({
  plugins: [twoFactorClient(), magicLinkClient(), inferAdditionalFields<typeof auth>()],
});

export type Session = typeof authClient.$Infer.Session;
