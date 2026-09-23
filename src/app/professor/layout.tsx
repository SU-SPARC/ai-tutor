import { CoursesStoreProvider } from "@/components/courses/courses-store";
import { requirePageAccess, requireProfessor } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

export default async function ProfessorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requirePageAccess(requireProfessor, "/professor");
  // Course/section state is client-side for this demo, and the section nav's
  // course switcher needs it too, so the provider wraps the whole workspace.
  return <CoursesStoreProvider>{children}</CoursesStoreProvider>;
}
