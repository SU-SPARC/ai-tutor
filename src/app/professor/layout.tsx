import { requirePageAccess, requireProfessor } from "@/lib/auth/authorization";

export default async function ProfessorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requirePageAccess(requireProfessor, "/professor");
  return children;
}
