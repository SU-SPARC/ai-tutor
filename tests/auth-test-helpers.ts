import {
  setPrincipalResolverForTests,
  type AuthenticatedPrincipal,
  type StudentOwner,
} from "@/lib/auth/principal";
import {
  createStudentAuthorizationForTests,
  setStudentOwnerResolverForTests,
} from "@/lib/auth/authorization";

export const TEST_STUDENT: AuthenticatedPrincipal = {
  kind: "user",
  userId: "user:test-student",
  displayName: "Test Student",
  email: "student@example.invalid",
  role: "student",
  roles: ["student"],
};

export const TEST_PROFESSOR: AuthenticatedPrincipal = {
  kind: "user",
  userId: "user:test-professor",
  displayName: "Test Professor",
  email: "professor@example.invalid",
  role: "professor",
  roles: ["student", "professor"],
};

export const TEST_ANONYMOUS_OWNER: StudentOwner = {
  kind: "anonymous",
  anonymousId: "anon:test-browser-a",
};

export function mockPrincipal(principal: AuthenticatedPrincipal | undefined) {
  setPrincipalResolverForTests(async () => principal);
}

export function mockStudentOwner(owner: StudentOwner | undefined) {
  setStudentOwnerResolverForTests(async () => owner);
}

export function authorizationForStudentOwner(owner: StudentOwner) {
  return createStudentAuthorizationForTests(owner);
}

export function resetAuthMocks() {
  setPrincipalResolverForTests(undefined);
  setStudentOwnerResolverForTests(undefined);
}
