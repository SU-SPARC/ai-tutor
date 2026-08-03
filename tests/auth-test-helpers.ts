import {
  setPrincipalResolverForTests,
  type AuthenticatedPrincipal,
  type StudentOwner,
} from "@/lib/auth/principal";
import { setStudentOwnerResolverForTests } from "@/lib/auth/anonymous-session";

export const TEST_STUDENT: AuthenticatedPrincipal = {
  kind: "user",
  userId: "user:test-student",
  displayName: "Test Student",
  email: "student@example.invalid",
  roles: ["student"],
};

export const TEST_PROFESSOR: AuthenticatedPrincipal = {
  kind: "user",
  userId: "user:test-professor",
  displayName: "Test Professor",
  email: "professor@example.invalid",
  roles: ["student", "professor"],
};

export const TEST_ADMIN: AuthenticatedPrincipal = {
  kind: "user",
  userId: "user:test-admin",
  displayName: "Test Administrator",
  email: "admin@example.invalid",
  roles: ["student", "professor", "admin"],
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

export function resetAuthMocks() {
  setPrincipalResolverForTests(undefined);
  setStudentOwnerResolverForTests(undefined);
}
