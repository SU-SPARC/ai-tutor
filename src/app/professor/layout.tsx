import { requirePageAccess, requireProfessor } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

export default async function ProfessorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requirePageAccess(requireProfessor, "/professor");
  return children;
}
