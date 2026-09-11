import "server-only";

import { CLERK_IDENTITY_PROVIDER } from "@/lib/auth/account-repository";
import {
  assertAuthorization,
  type AnalyticsAuthorization,
} from "@/lib/auth/authorization";
import {
  findInstructorStudentAccountLink,
  recordInstructorStudentIdentityView,
} from "@/lib/data/data-store";
import type { StudentAccountLink } from "@/lib/data/student-identity-repository";
import type { InstructorStudentIdentity } from "@/lib/types";

/**
 * What an identity provider can say about a subject: the three fields this
 * feature is allowed to show, or a reason it showed nothing. A provider that
 * no longer holds the account is reported separately from one that could not
 * be reached, because only the second is worth retrying.
 */
export type ProviderIdentity =
  | { displayName: string; email?: string; username?: string }
  | "unavailable"
  | "unlinked";

type StudentIdentityDependencies = {
  findAccountLink: (
    authorization: AnalyticsAuthorization,
    studentKey: string,
  ) => Promise<StudentAccountLink | undefined>;
  lookUpIdentity: (link: {
    identityProvider: string;
    subject: string;
  }) => Promise<ProviderIdentity>;
  recordView: (
    authorization: AnalyticsAuthorization,
    input: { requestId?: string; status: string; studentKey: string },
  ) => Promise<void>;
};

let testDependencies: Partial<StudentIdentityDependencies> | undefined;

/**
 * Resolves the account identity behind a pseudonymous student key.
 *
 * Returns `undefined` when the key belongs to no student in the analytics
 * population, so the caller can answer exactly as it would for a key that was
 * never issued. Every other outcome is a state the instructor can be shown.
 *
 * The order is deliberate: resolve, look up, record, and only then return. An
 * identity that cannot be audited is never disclosed.
 */
export async function resolveInstructorStudentIdentity(
  authorization: AnalyticsAuthorization,
  studentKey: string,
  options: { requestId?: string } = {},
): Promise<InstructorStudentIdentity | undefined> {
  assertAuthorization(authorization, "professor");
  const dependencies = resolveDependencies();
  const link = await dependencies.findAccountLink(authorization, studentKey);

  if (!link) {
    return undefined;
  }

  const identity = await identityForLink(link, dependencies.lookUpIdentity);

  try {
    await dependencies.recordView(authorization, {
      requestId: options.requestId,
      status: identity.status,
      studentKey,
    });
  } catch {
    // Fail closed. A reveal that could not be written to the audit trail is
    // not served: the resolved identity is discarded here and the instructor
    // is told to try again, with no hint of which step failed. The error is
    // not logged or re-raised, because the identity is in scope where it is
    // thrown and must not travel with it.
    return { status: "unavailable" };
  }

  return identity;
}

export async function identityForLink(
  link: StudentAccountLink,
  lookUpIdentity: StudentIdentityDependencies["lookUpIdentity"],
): Promise<InstructorStudentIdentity> {
  if (link.kind !== "account") {
    return { status: link.kind };
  }

  const found = await lookUpIdentity({
    identityProvider: link.identityProvider,
    subject: link.subject,
  });

  if (found === "unavailable" || found === "unlinked") {
    return { status: found };
  }

  // Each optional field is omitted rather than sent as null, so a field the
  // account does not hold is absent from the payload instead of being an empty
  // value the interface has to interpret.
  return {
    displayName: found.displayName,
    ...(found.email ? { email: found.email } : {}),
    ...(found.username ? { username: found.username } : {}),
    status: "identified",
  };
}

/**
 * Clerk owns the student's name, username, and email address; this project
 * stores a projection of the first and last for account handling, but the
 * reveal reads the live record so an instructor is never shown a stale name.
 * Only the display name, Clerk's own `username` field, and the primary email
 * address are taken from the response.
 */
async function lookUpClerkIdentity(link: {
  identityProvider: string;
  subject: string;
}): Promise<ProviderIdentity> {
  if (link.identityProvider !== CLERK_IDENTITY_PROVIDER) {
    return "unlinked";
  }

  let user;
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    user = await (await clerkClient()).users.getUser(link.subject);
  } catch (cause) {
    // A deleted account is permanent; anything else may be a transient outage.
    // Neither the error nor its body is logged: both can carry the account's
    // own identifiers.
    return isNotFoundError(cause) ? "unlinked" : "unavailable";
  }

  return user ? identityFromProviderUser(user) : "unlinked";
}

/**
 * The whole of the mapping from a provider record to what may be shown. It
 * reads four fields and ignores everything else the provider sent, so a future
 * addition to the provider's user object cannot widen this payload by
 * accident.
 */
export function identityFromProviderUser(user: ProviderUser): ProviderIdentity {
  const email = primaryEmailAddress(user);
  const displayName =
    user.fullName?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    email;
  // Clerk's own `username`, never something assembled from the email address,
  // the name, or the subject. An account without one simply has none.
  const username = user.username?.trim() || undefined;

  return displayName ? { displayName, email, username } : "unlinked";
}

/**
 * The primary address if the account has one, and otherwise a verified address
 * it does hold. An account with neither reports no email rather than having one
 * guessed for it.
 */
/**
 * Only the fields the reveal is permitted to read. Everything else a provider
 * returns — the subject, phone numbers, external accounts, metadata, sessions
 * — is deliberately not part of this shape.
 */
export type ProviderUser = {
  emailAddresses: ReadonlyArray<{
    emailAddress: string;
    id: string;
    verification: { status: string | null } | null;
  }>;
  firstName?: string | null;
  fullName?: string | null;
  lastName?: string | null;
  primaryEmailAddressId: string | null;
  username?: string | null;
};

function primaryEmailAddress(user: ProviderUser) {
  const addresses = user.emailAddresses ?? [];
  const primary = addresses.find(
    ({ id }) => id === user.primaryEmailAddressId,
  )?.emailAddress;

  return (
    primary?.trim() ||
    addresses
      .find(({ verification }) => verification?.status === "verified")
      ?.emailAddress?.trim() ||
    undefined
  );
}

function isNotFoundError(cause: unknown) {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { status?: unknown }).status === 404
  );
}

function resolveDependencies(): StudentIdentityDependencies {
  const defaults: StudentIdentityDependencies = {
    findAccountLink: findInstructorStudentAccountLink,
    lookUpIdentity: lookUpClerkIdentity,
    recordView: recordInstructorStudentIdentityView,
  };

  return process.env.NODE_ENV === "test" && testDependencies
    ? { ...defaults, ...testDependencies }
    : defaults;
}

export function setStudentIdentityDependenciesForTests(
  dependencies?: Partial<StudentIdentityDependencies>,
) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "Student-identity injection is restricted to the test environment.",
    );
  }
  testDependencies = dependencies;
}
