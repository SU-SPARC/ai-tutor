import { requirePageRole } from "@/lib/auth/page-authorization";

export default async function ProfessorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requirePageRole("professor", "/professor");
  return children;
}
