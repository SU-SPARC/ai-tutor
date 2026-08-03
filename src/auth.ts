import { randomBytes } from "node:crypto";

import NextAuth, { type User } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";

import {
  IdentityConflictError,
  upsertOidcAccount,
  type ApplicationRole,
} from "@/lib/auth/account-repository";
import { getServerEnv } from "@/lib/env/server";

export const INSTITUTIONAL_PROVIDER_ID = "institutional-oidc";
export const LOCAL_TEST_PROVIDER_ID = "local-test-identity";
export const AUTH_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

const env = getServerEnv();

// Auth.js uses AUTH_URL to construct callbacks. APP_URL is validated centrally
// and remains the single documented application-origin setting.
process.env.AUTH_URL = env.APP_URL;

const providers: Provider[] = [];

if (env.AUTH_OIDC_ENABLED) {
  providers.push({
    id: INSTITUTIONAL_PROVIDER_ID,
    name: "Institutional sign-in",
    type: "oidc",
    issuer: env.AUTH_ISSUER_URL,
    clientId: env.AUTH_CLIENT_ID,
    clientSecret: env.AUTH_CLIENT_SECRET,
    authorization: { params: { scope: "openid profile email" } },
    checks: ["pkce", "state"],
    profile(profile) {
      return {
        id: requiredClaim(profile.sub, "subject"),
        email: requiredClaim(profile.email, "email"),
        name: profile.name ? String(profile.name) : String(profile.email),
      };
    },
  });
}

if (env.AUTH_TEST_MODE) {
  providers.push(
    Credentials({
      id: LOCAL_TEST_PROVIDER_ID,
      name: "Local test identity",
      credentials: {
        identity: {
          label: "Test identity",
          type: "select",
          options: [
            { label: "Student", value: "student" },
            { label: "Professor", value: "professor" },
            { label: "Administrator", value: "admin" },
            { label: "Disabled user", value: "disabled" },
          ],
        },
      },
      authorize(credentials) {
        const identity = String(credentials?.identity ?? "");
        return localTestIdentity(identity);
      },
    }),
  );
}

// With no provider configured, Auth.js still owns its endpoint and sign-out
// behavior, but cannot create a session. A per-process development secret avoids
// inventing or committing credentials; deployed environments require the real
// AUTH_SESSION_SECRET through environment validation.
const authSecret =
  env.AUTH_SESSION_SECRET ??
  (!env.IS_DEPLOYED_ENVIRONMENT
    ? randomBytes(32).toString("base64url")
    : undefined);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  secret: authSecret,
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    updateAge: 60 * 60,
  },
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (user.authMode === "test") {
        return user.id !== "test:disabled";
      }

      if (
        !env.AUTH_OIDC_ENABLED ||
        account?.provider !== INSTITUTIONAL_PROVIDER_ID ||
        !account.providerAccountId ||
        !profile?.sub ||
        account.providerAccountId !== String(profile.sub) ||
        !user.email
      ) {
        return false;
      }

      try {
        const applicationUser = await upsertOidcAccount({
          issuer: env.AUTH_ISSUER_URL!,
          subject: account.providerAccountId,
          email: user.email,
          displayName: user.name ?? user.email,
        });

        if (applicationUser.status !== "active") {
          return false;
        }

        attachApplicationIdentity(user, {
          appUserId: applicationUser.id,
          roles: applicationUser.roles,
          sessionVersion: applicationUser.sessionVersion,
          authMode: "oidc",
        });
        return true;
      } catch (error) {
        if (error instanceof IdentityConflictError) {
          return "/sign-in?error=IdentityConflict";
        }
        throw error;
      }
    },
    jwt({ token, user }) {
      if (user?.appUserId && user.authMode && user.sessionVersion) {
        token.appUserId = user.appUserId;
        token.authMode = user.authMode;
        token.roles = user.roles ?? [];
        token.sessionVersion = user.sessionVersion;
        token.sub = user.appUserId;
      }

      // Application code does not need provider profile data in the encrypted
      // session token. The stable application ID is sufficient.
      delete token.email;
      delete token.name;
      delete token.picture;
      return token;
    },
    session({ session, token }) {
      const applicationToken = token as typeof token & {
        appUserId?: string;
        authMode?: "oidc" | "test";
        roles?: ApplicationRole[];
        sessionVersion?: number;
      };
      if (
        !applicationToken.appUserId ||
        !applicationToken.authMode ||
        !applicationToken.sessionVersion ||
        !session.user
      ) {
        return session;
      }

      session.user.appUserId = applicationToken.appUserId;
      session.user.authMode = applicationToken.authMode;
      session.user.roles = applicationToken.roles ?? [];
      session.user.sessionVersion = applicationToken.sessionVersion;
      return session;
    },
  },
});

function requiredClaim(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `The identity provider did not return a valid ${name} claim.`,
    );
  }
  return value.trim();
}

function localTestIdentity(identity: string): User | null {
  const definitions: Record<
    string,
    { displayName: string; roles: ApplicationRole[] }
  > = {
    student: { displayName: "Local Student", roles: ["student"] },
    professor: {
      displayName: "Local Professor",
      roles: ["student", "professor"],
    },
    admin: {
      displayName: "Local Administrator",
      roles: ["student", "professor", "admin"],
    },
    disabled: { displayName: "Disabled Test User", roles: [] },
  };
  const definition = definitions[identity];

  if (!definition) {
    return null;
  }

  return {
    id: `test:${identity}`,
    appUserId: `test:${identity}`,
    authMode: "test",
    roles: definition.roles,
    sessionVersion: 1,
    name: definition.displayName,
    email: `${identity}@example.invalid`,
  };
}

function attachApplicationIdentity(
  user: User,
  identity: Required<
    Pick<User, "appUserId" | "authMode" | "roles" | "sessionVersion">
  >,
) {
  user.appUserId = identity.appUserId;
  user.authMode = identity.authMode;
  user.roles = identity.roles;
  user.sessionVersion = identity.sessionVersion;
}
