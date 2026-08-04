import { requirePageAccess, requireProfessor } from "@/lib/auth/authorization";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requirePageAccess(requireProfessor, "/admin");
  return children;
}
