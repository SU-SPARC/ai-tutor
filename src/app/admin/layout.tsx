import { requirePageRole } from "@/lib/auth/page-authorization";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requirePageRole("professor", "/admin");
  return children;
}
