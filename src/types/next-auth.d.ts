import type { DefaultSession } from "next-auth";

import type { ApplicationRole } from "@/lib/auth/account-repository";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      appUserId: string;
      authMode: "oidc" | "test";
      roles: ApplicationRole[];
      sessionVersion: number;
    };
  }

  interface User {
    appUserId?: string;
    authMode?: "oidc" | "test";
    roles?: ApplicationRole[];
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    appUserId?: string;
    authMode?: "oidc" | "test";
    roles?: ApplicationRole[];
    sessionVersion?: number;
  }
}
