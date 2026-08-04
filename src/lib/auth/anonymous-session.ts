import "server-only";

import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { cookies } from "next/headers";

import { getServerEnv } from "@/lib/env/server";

export const ANONYMOUS_SESSION_COOKIE = "suffolk-tutor-anonymous";

const localEphemeralSecret = randomBytes(32).toString("base64url");
export class AnonymousPilotUnavailableError extends Error {
  constructor() {
    super("Sign in to use student practice in this environment.");
    this.name = "AnonymousPilotUnavailableError";
  }
}

export async function resolveAnonymousStudentOwner(
  options: { createAnonymous?: boolean } = {},
) {
  const env = getServerEnv();
  if (!env.ANONYMOUS_PILOT_ENABLED) {
    if (options.createAnonymous) {
      throw new AnonymousPilotUnavailableError();
    }
    return undefined;
  }

  const cookieStore = await cookies();
  const existing = verifyAnonymousCookie(
    cookieStore.get(ANONYMOUS_SESSION_COOKIE)?.value,
  );
  if (existing) {
    return { kind: "anonymous" as const, anonymousId: existing };
  }

  if (!options.createAnonymous) {
    return undefined;
  }

  const anonymousId = `anon:${randomUUID()}`;
  const expires = new Date(
    Date.now() + env.ANONYMOUS_COOKIE_DAYS * 24 * 60 * 60 * 1_000,
  );
  cookieStore.set(
    ANONYMOUS_SESSION_COOKIE,
    signAnonymousCookie(anonymousId, expires),
    {
      httpOnly: true,
      secure: env.APP_URL.startsWith("https://"),
      sameSite: "lax",
      path: "/",
      expires,
    },
  );
  return { kind: "anonymous" as const, anonymousId };
}

export async function clearAnonymousSession() {
  const cookieStore = await cookies();
  cookieStore.set(ANONYMOUS_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: getServerEnv().APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function readAnonymousCookieSubject() {
  const cookieStore = await cookies();
  return verifyAnonymousCookie(
    cookieStore.get(ANONYMOUS_SESSION_COOKIE)?.value,
  );
}

export function signAnonymousCookie(anonymousId: string, expires: Date) {
  const expirySeconds = Math.floor(expires.getTime() / 1_000);
  const payload = `${anonymousId}.${expirySeconds}`;
  return `${payload}.${cookieSignature(payload)}`;
}

export function verifyAnonymousCookie(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parts = value.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  const [anonymousId, expiry, signature] = parts;
  const expirySeconds = Number(expiry);
  if (
    !/^anon:[0-9a-f-]{36}$/i.test(anonymousId) ||
    !Number.isSafeInteger(expirySeconds) ||
    expirySeconds <= Math.floor(Date.now() / 1_000)
  ) {
    return undefined;
  }

  const expected = Buffer.from(cookieSignature(`${anonymousId}.${expiry}`));
  const supplied = Buffer.from(signature);
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  ) {
    return undefined;
  }
  return anonymousId;
}

function cookieSignature(payload: string) {
  const env = getServerEnv();
  const secret = env.ANONYMOUS_ID_SECRET ?? localEphemeralSecret;
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
