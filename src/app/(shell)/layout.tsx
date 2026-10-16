import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@/lib/session";

export default async function ShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  const user = session?.user
    ? {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      }
    : null;

  return <AppShell user={user}>{children}</AppShell>;
}
