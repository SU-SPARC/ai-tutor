import "server-only";

import { redirect } from "next/navigation";

import {
  AnonymousPilotUnavailableError,
  resolveAnonymousStudentOwner,
} from "@/lib/auth/anonymous-session";
import {
  resolveAuthenticatedPrincipal,
  type AuthenticatedPrincipal,
  type StudentOwner,
} from "@/lib/auth/principal";
import { signInPath } from "@/lib/auth/return-path";
import type {
  RetrievalChunk,
  ReviewMetadata,
  SourceMetadata,
} from "@/lib/types";

export const AUTHORIZATION_PERMISSIONS = ["student", "professor"] as const;

export type AuthorizationPermission =
  (typeof AUTHORIZATION_PERMISSIONS)[number];

export type CurrentUserDto = {
  displayName: string;
  email: string;
};

export type ReviewerAttribution = {
  displayName: string;
  userId: string;
};

const authorizationMarker: unique symbol = Symbol("authorization-grant");

export type AuthenticatedAuthorization<
  Permission extends Exclude<AuthorizationPermission, "student">,
> = Readonly<{
  [authorizationMarker]: true;
  permission: Permission;
  principal: AuthenticatedPrincipal;
}>;

export type StudentAuthorization = Readonly<{
  [authorizationMarker]: true;
  owner: StudentOwner;
  permission: "student";
  principal?: AuthenticatedPrincipal;
}>;

export type AuthenticatedStudentAuthorization = StudentAuthorization &
  Readonly<{
    owner: { kind: "user"; userId: string };
    principal: AuthenticatedPrincipal;
  }>;

export type ProfessorAuthorization = AuthenticatedAuthorization<"professor">;
export type ProfessorReviewAuthorization = ProfessorAuthorization;
export type AnalyticsAuthorization = ProfessorAuthorization;

type AnyAuthorization =
  | StudentAuthorization
  | AuthenticatedAuthorization<Exclude<AuthorizationPermission, "student">>;

type StudentOwnerResolver = () => Promise<StudentOwner | undefined>;
let testStudentOwnerResolver: StudentOwnerResolver | undefined;

const STUDENT_FACING_TRUST_LEVELS = new Set([
  "public_original",
  "professor_approved",
  "course_approved",
]);

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication is required.");
    this.name = "AuthenticationRequiredError";
  }
}

export class AuthorizationDeniedError extends Error {
  constructor() {
    super("You do not have permission to perform this action.");
    this.name = "AuthorizationDeniedError";
  }
}

export class ResourceNotFoundError extends Error {
  constructor() {
    super("The requested resource was not found.");
    this.name = "ResourceNotFoundError";
  }
}

/**
 * Resolves the current active application account. The returned roles are for
 * server-side policy evaluation only and must not be serialized to clients.
 */
export async function currentAuthenticatedUser() {
  return resolveAuthenticatedPrincipal();
}

export function toCurrentUserDto(
  principal: AuthenticatedPrincipal,
): CurrentUserDto {
  return {
    displayName: principal.displayName,
    email: principal.email,
  };
}

export function hasPermission(
  principal: AuthenticatedPrincipal | undefined,
  permission: AuthorizationPermission,
) {
  if (!principal) {
    return false;
  }

  switch (permission) {
    case "student":
      return principal.role === "student" || principal.role === "professor";
    case "professor":
      return principal.role === "professor";
    default:
      return false;
  }
}

export async function requireStudent(): Promise<AuthenticatedStudentAuthorization> {
  const principal = await requireAuthenticatedUser();
  if (!hasPermission(principal, "student")) {
    throw new AuthorizationDeniedError();
  }
  return studentAuthorizationFor(principal);
}

export async function requireAuthenticatedUser(): Promise<AuthenticatedPrincipal> {
  const principal = await currentAuthenticatedUser();
  if (!principal) {
    throw new AuthenticationRequiredError();
  }
  return principal;
}

export async function requireStudentAccess(
  options: { allowAnonymous?: boolean; createAnonymous?: boolean } = {},
): Promise<StudentAuthorization> {
  const principal = await currentAuthenticatedUser();

  if (principal) {
    if (!hasPermission(principal, "student")) {
      throw new AuthorizationDeniedError();
    }
    return studentAuthorizationFor(principal);
  }

  if (!options.allowAnonymous) {
    throw new AuthenticationRequiredError();
  }

  const owner =
    process.env.NODE_ENV === "test" && testStudentOwnerResolver
      ? await testStudentOwnerResolver()
      : await resolveAnonymousStudentOwner({
          createAnonymous: options.createAnonymous,
        });

  if (!owner || owner.kind !== "anonymous") {
    throw new AuthenticationRequiredError();
  }

  return Object.freeze({
    [authorizationMarker]: true as const,
    owner,
    permission: "student" as const,
  });
}

export async function requireProfessor(): Promise<ProfessorAuthorization> {
  return requireAuthenticatedPermission("professor");
}

export async function requireProfessorReview(): Promise<ProfessorReviewAuthorization> {
  return requireProfessor();
}

export async function requireAnalyticsAccess(): Promise<AnalyticsAuthorization> {
  return requireProfessor();
}

export function reviewerAttribution(
  authorization: ProfessorReviewAuthorization,
): ReviewerAttribution {
  assertAuthorization(authorization, "professor");
  return {
    displayName: authorization.principal.displayName,
    userId: authorization.principal.userId,
  };
}

export function ownerFromAuthorization(
  authorization: StudentAuthorization,
): StudentOwner {
  assertAuthorization(authorization, "student");
  return authorization.owner;
}

export function isOwnedBy(
  authorization: StudentAuthorization,
  resourceOwner: StudentOwner,
) {
  const owner = ownerFromAuthorization(authorization);
  return isSameOwner(owner, resourceOwner);
}

export function isSameOwner(left: StudentOwner, right: StudentOwner) {
  return (
    left.kind === right.kind && ownerIdentifier(left) === ownerIdentifier(right)
  );
}

export function requireOwnership(
  authorization: StudentAuthorization,
  resourceOwner: StudentOwner,
) {
  if (!isOwnedBy(authorization, resourceOwner)) {
    // Ownership failures are intentionally indistinguishable from missing
    // records so resource identifiers cannot be enumerated.
    throw new ResourceNotFoundError();
  }
}

export function isPublishedContent(content: {
  review: ReviewMetadata;
  source: SourceMetadata;
}) {
  return (
    content.review.status === "approved" &&
    content.source.visibility === "public" &&
    STUDENT_FACING_TRUST_LEVELS.has(content.source.trustLevel)
  );
}

export function requirePublishedContent<
  T extends {
    review: ReviewMetadata;
    source: SourceMetadata;
  },
>(content: T): T {
  if (!isPublishedContent(content)) {
    throw new ResourceNotFoundError();
  }
  return content;
}

export function isStudentSafeRetrievalContent(chunk: RetrievalChunk) {
  return (
    isPublishedContent(chunk) ||
    (isPrivateReferenceRetrievalEligible(chunk) &&
      chunk.body === chunk.llmSafeSummary)
  );
}

export function isRetrievalEligibleContent(chunk: RetrievalChunk) {
  return (
    isPublishedContent(chunk) || isPrivateReferenceRetrievalEligible(chunk)
  );
}

export function assertAuthorization<Permission extends AuthorizationPermission>(
  authorization: AnyAuthorization,
  permission: Permission,
): void {
  if (
    !authorization ||
    typeof authorization !== "object" ||
    authorization[authorizationMarker] !== true ||
    authorization.permission !== permission
  ) {
    throw new AuthorizationDeniedError();
  }
}

export async function authorizeApi<Authorization>(
  requirement: () => Promise<Authorization>,
) {
  try {
    return {
      authorization: await requirement(),
      ok: true as const,
    };
  } catch (error) {
    if (
      error instanceof AuthenticationRequiredError ||
      error instanceof AnonymousPilotUnavailableError
    ) {
      return {
        ok: false as const,
        response: Response.json({ error: error.message }, { status: 401 }),
      };
    }
    if (error instanceof AuthorizationDeniedError) {
      return {
        ok: false as const,
        response: Response.json({ error: error.message }, { status: 403 }),
      };
    }
    throw error;
  }
}

export async function authorizeStudentResourceApi() {
  try {
    return {
      authorization: await requireStudentAccess({ allowAnonymous: true }),
      ok: true as const,
    };
  } catch (error) {
    if (
      error instanceof AuthenticationRequiredError ||
      error instanceof AuthorizationDeniedError ||
      error instanceof AnonymousPilotUnavailableError
    ) {
      return {
        ok: false as const,
        response: Response.json(
          { error: "Tutor session was not found." },
          { status: 404 },
        ),
      };
    }
    throw error;
  }
}

export async function requirePageAccess<Authorization>(
  requirement: () => Promise<Authorization>,
  returnTo = "/",
) {
  try {
    return await requirement();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect(signInPath(returnTo));
    }
    if (error instanceof AuthorizationDeniedError) {
      redirect("/forbidden");
    }
    throw error;
  }
}

export function setStudentOwnerResolverForTests(
  resolver?: StudentOwnerResolver,
) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "Student-owner injection is restricted to the test environment.",
    );
  }
  testStudentOwnerResolver = resolver;
}

export function createStudentAuthorizationForTests(
  owner: StudentOwner,
): StudentAuthorization {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "Synthetic student authorization is restricted to the test environment.",
    );
  }
  return Object.freeze({
    [authorizationMarker]: true as const,
    owner,
    permission: "student" as const,
  });
}

async function requireAuthenticatedPermission<
  Permission extends AuthorizationPermission,
>(permission: Permission) {
  const principal = await requireAuthenticatedUser();
  if (!hasPermission(principal, permission)) {
    throw new AuthorizationDeniedError();
  }
  return Object.freeze({
    [authorizationMarker]: true as const,
    permission,
    principal,
  });
}

function studentAuthorizationFor(
  principal: AuthenticatedPrincipal,
): AuthenticatedStudentAuthorization {
  return Object.freeze({
    [authorizationMarker]: true as const,
    owner: { kind: "user" as const, userId: principal.userId },
    permission: "student" as const,
    principal,
  });
}

function ownerIdentifier(owner: StudentOwner) {
  return owner.kind === "user" ? owner.userId : owner.anonymousId;
}

function isPrivateReferenceRetrievalEligible(chunk: RetrievalChunk) {
  return (
    chunk.review.status === "approved" &&
    chunk.source.visibility === "private" &&
    chunk.source.trustLevel === "private_reference" &&
    chunk.source.sourceType === "private_reference_pattern" &&
    Boolean(chunk.llmSafeSummary?.trim())
  );
}

export { AnonymousPilotUnavailableError };
