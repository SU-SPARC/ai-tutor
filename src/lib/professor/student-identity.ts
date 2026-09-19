import "server-only";

import { CLERK_IDENTITY_PROVIDER } from "@/lib/auth/account-repository";
import {
  assertAuthorization,
  type AnalyticsAuthorization,
} from "@/lib/auth/authorization";
import {
  findInstructorStudentAccountLink,
  findInstructorStudentAccountLinks,
  listInstructorStudentTopicRoster,
  recordInstructorStudentIdentityView,
  recordInstructorStudentIdentityViews,
} from "@/lib/data/data-store";
import type { StudentAccountLink } from "@/lib/data/student-identity-repository";
import {
  rosterStudentKeys,
  sortRosterStudents,
  type RosterSortName,
} from "@/lib/professor/student-roster";
import type {
  InstructorRosterStudent,
  InstructorStudentIdentity,
  InstructorStudentRosterIdentity,
  InstructorStudentTopicRoster,
} from "@/lib/types";

/**
 * What an identity provider can say about a subject: the three fields this
 * feature is allowed to show, the split name the roster orders by, or a
 * reason it showed nothing. A provider that no longer holds the account is
 * reported separately from one that could not be reached, because only the
 * second is worth retrying. The family and given names never leave the
 * server: the single reveal omits them and the roster sorts by them.
 */
export type ProviderIdentity =
  | {
      displayName: string;
      email?: string;
      familyName?: string;
      givenName?: string;
      username?: string;
    }
  | "unavailable"
  | "unlinked";

type ProviderLink = { identityProvider: string; subject: string };

type StudentIdentityDependencies = {
  findAccountLink: (
    authorization: AnalyticsAuthorization,
    studentKey: string,
  ) => Promise<StudentAccountLink | undefined>;
  findAccountLinks: (
    authorization: AnalyticsAuthorization,
    studentKeys: string[],
  ) => Promise<Map<string, StudentAccountLink>>;
  listTopicRoster: (
    authorization: AnalyticsAuthorization,
  ) => Promise<InstructorStudentTopicRoster>;
  lookUpIdentity: (link: ProviderLink) => Promise<ProviderIdentity>;
  /** Keyed by provider subject; every requested subject has an entry. */
  lookUpIdentities: (
    links: ProviderLink[],
  ) => Promise<Map<string, ProviderIdentity>>;
  recordView: (
    authorization: AnalyticsAuthorization,
    input: { requestId?: string; status: string; studentKey: string },
  ) => Promise<void>;
  recordViews: (
    authorization: AnalyticsAuthorization,
    input: {
      requestId?: string;
      views: Array<{ status: string; studentKey: string }>;
    },
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

/**
 * Reveals every student on the Students page at once, grouped by practised
 * topic and ordered by last name within each group. The rules are the single
 * reveal's, applied to the whole roster: the population is the page's own,
 * the names are read live from the provider, only the display name is
 * returned, and the reveal is recorded before it is served. The audit is one
 * row per student in one statement, so a roster is either fully recorded or
 * — if that write fails — served with every identity withheld as
 * `unavailable`, and with no name in it to order by.
 */
export async function resolveInstructorStudentRoster(
  authorization: AnalyticsAuthorization,
  options: { requestId?: string } = {},
): Promise<InstructorStudentTopicRoster> {
  assertAuthorization(authorization, "professor");
  const dependencies = resolveDependencies();
  const roster = await dependencies.listTopicRoster(authorization);
  const studentKeys = rosterStudentKeys(roster);
  const links = await dependencies.findAccountLinks(authorization, studentKeys);
  const resolved = await rosterIdentitiesForLinks(
    studentKeys,
    links,
    dependencies.lookUpIdentities,
  );

  try {
    await dependencies.recordViews(authorization, {
      requestId: options.requestId,
      views: studentKeys.map((studentKey) => ({
        status: resolved.get(studentKey)?.identity.status ?? "unavailable",
        studentKey,
      })),
    });
  } catch {
    // Fail closed, exactly as the single reveal does: the names are in scope
    // here and go no further. Nothing is logged or re-raised.
    return withRosterIdentities(roster, new Map());
  }

  return withRosterIdentities(roster, resolved);
}

type ResolvedRosterIdentity = {
  identity: InstructorStudentRosterIdentity;
  name?: RosterSortName;
};

/**
 * Resolves each pseudonym's roster identity. Students who never signed in
 * are never sent to the provider; account holders are looked up together.
 * A key the population no longer holds — an account disabled between the
 * roster read and this one — is reported as unlinked.
 */
export async function rosterIdentitiesForLinks(
  studentKeys: string[],
  links: ReadonlyMap<string, StudentAccountLink>,
  lookUpIdentities: StudentIdentityDependencies["lookUpIdentities"],
): Promise<Map<string, ResolvedRosterIdentity>> {
  const providerLinks = new Map<string, ProviderLink>();
  for (const link of links.values()) {
    if (link.kind === "account" && !providerLinks.has(link.subject)) {
      providerLinks.set(link.subject, {
        identityProvider: link.identityProvider,
        subject: link.subject,
      });
    }
  }

  const found =
    providerLinks.size > 0
      ? await lookUpIdentities([...providerLinks.values()])
      : new Map<string, ProviderIdentity>();
  const resolved = new Map<string, ResolvedRosterIdentity>();

  for (const studentKey of studentKeys) {
    const link = links.get(studentKey) ?? { kind: "unlinked" as const };

    if (link.kind !== "account") {
      resolved.set(studentKey, { identity: { status: link.kind } });
      continue;
    }

    const identity = found.get(link.subject) ?? "unavailable";

    if (identity === "unavailable" || identity === "unlinked") {
      resolved.set(studentKey, { identity: { status: identity } });
      continue;
    }

    // Only the display name is built into the payload. The split name stays
    // beside it, for ordering, and is discarded with this map.
    resolved.set(studentKey, {
      identity: { displayName: identity.displayName, status: "identified" },
      name: {
        displayName: identity.displayName,
        familyName: identity.familyName,
        givenName: identity.givenName,
      },
    });
  }

  return resolved;
}

function withRosterIdentities(
  roster: InstructorStudentTopicRoster,
  resolved: ReadonlyMap<string, ResolvedRosterIdentity>,
): InstructorStudentTopicRoster {
  const names = new Map<string, RosterSortName>();
  for (const [studentKey, { name }] of resolved) {
    if (name) {
      names.set(studentKey, name);
    }
  }

  const attach = (students: InstructorRosterStudent[]) =>
    sortRosterStudents(
      students.map((student) => ({
        identity: resolved.get(student.studentKey)?.identity ?? {
          status: "unavailable",
        },
        studentKey: student.studentKey,
      })),
      names,
    );

  return {
    mode: roster.mode,
    revealed: true,
    topics: roster.topics.map((group) => ({
      ...group,
      students: attach(group.students),
    })),
    unassigned: attach(roster.unassigned),
  };
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

/** Clerk filters a user listing by at most this many ids per request. */
const PROVIDER_LOOKUP_BATCH_SIZE = 100;

/**
 * The roster's provider read: the same fields as `lookUpClerkIdentity`, for
 * up to a hundred accounts per request. An id the listing does not return
 * belongs to a deleted account and is unlinked; a request that fails leaves
 * every account in it unavailable, and the others unaffected. As with the
 * single lookup, neither the error nor its body is logged.
 */
async function lookUpClerkIdentities(
  links: ProviderLink[],
): Promise<Map<string, ProviderIdentity>> {
  const identities = new Map<string, ProviderIdentity>();
  const subjects: string[] = [];

  for (const link of links) {
    if (link.identityProvider !== CLERK_IDENTITY_PROVIDER) {
      identities.set(link.subject, "unlinked");
    } else if (!subjects.includes(link.subject)) {
      subjects.push(link.subject);
    }
  }

  for (
    let start = 0;
    start < subjects.length;
    start += PROVIDER_LOOKUP_BATCH_SIZE
  ) {
    const batch = subjects.slice(start, start + PROVIDER_LOOKUP_BATCH_SIZE);
    let users: ReadonlyArray<ProviderUser & { id: string }>;

    try {
      const { clerkClient } = await import("@clerk/nextjs/server");
      const listing = await (
        await clerkClient()
      ).users.getUserList({ limit: batch.length, userId: batch });
      users = listing.data;
    } catch {
      for (const subject of batch) {
        identities.set(subject, "unavailable");
      }
      continue;
    }

    const bySubject = new Map(users.map((user) => [user.id, user]));
    for (const subject of batch) {
      const user = bySubject.get(subject);
      identities.set(subject, user ? identityFromProviderUser(user) : "unlinked");
    }
  }

  return identities;
}

/**
 * The whole of the mapping from a provider record to what may be shown or
 * ordered by. It reads five fields and ignores everything else the provider
 * sent, so a future addition to the provider's user object cannot widen this
 * payload by accident. The family and given names are read only so the
 * roster can order students by last name; no response includes them.
 */
export function identityFromProviderUser(user: ProviderUser): ProviderIdentity {
  const email = primaryEmailAddress(user);
  const givenName = user.firstName?.trim() || undefined;
  const familyName = user.lastName?.trim() || undefined;
  const displayName =
    user.fullName?.trim() ||
    [givenName, familyName].filter(Boolean).join(" ").trim() ||
    email;
  // Clerk's own `username`, never something assembled from the email address,
  // the name, or the subject. An account without one simply has none.
  const username = user.username?.trim() || undefined;

  return displayName
    ? { displayName, email, familyName, givenName, username }
    : "unlinked";
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
    findAccountLinks: findInstructorStudentAccountLinks,
    listTopicRoster: listInstructorStudentTopicRoster,
    lookUpIdentities: lookUpClerkIdentities,
    lookUpIdentity: lookUpClerkIdentity,
    recordView: recordInstructorStudentIdentityView,
    recordViews: recordInstructorStudentIdentityViews,
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
