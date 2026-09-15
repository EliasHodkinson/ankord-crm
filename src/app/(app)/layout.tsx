import Link from "next/link";
import { redirect } from "next/navigation";
import { AnkordLogo } from "@/components/brand/logo";
import { Nav } from "@/components/app/nav";
import { MobileNav } from "@/components/app/mobile-nav";
import { UserMenu } from "@/components/app/user-menu";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { CommandPalette } from "@/components/app/command-palette";
import { KeyboardShortcuts } from "@/components/app/keyboard-shortcuts";
import { getSession } from "@/lib/auth/session";
import { dueCount } from "@/lib/data/tasks";
import { isAuthConfigured, isDatabaseConfigured } from "@/lib/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isAuthConfigured() || !isDatabaseConfigured()) redirect("/setup");

  const session = await getSession();
  if (!session) redirect("/signin");
  const { user } = session;

  // A number on the rail is the cheapest reminder there is.
  const due = await dueCount(user.id).catch(() => 0);

  return (
    <div className="flex min-h-dvh">
      {/* Navigation rail — Deep Coastal, the brand's own panel colour */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-[var(--nav-border)] bg-[var(--nav-bg)] lg:flex">
        <Link
          href="/"
          className="flex h-14 items-center px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-sunrise-400)]"
        >
          <AnkordLogo className="h-[18px] w-auto text-white" />
          <span className="ml-2.5 border-l border-[var(--nav-border)] pl-2.5 text-[11px] font-semibold tracking-[0.14em] text-[var(--color-sunrise-400)] uppercase">
            CRM
          </span>
        </Link>
        <Nav counts={{ due }} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Wraps to two rows on small screens so the search field stays usable */}
        <header className="sticky top-0 z-40 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border)] bg-[var(--surface)]/85 px-4 py-2.5 backdrop-blur-md md:h-14 md:flex-nowrap md:py-0">
          <MobileNav counts={{ due }} />
          <Link href="/" className="lg:hidden">
            <AnkordLogo className="h-4 w-auto text-[var(--color-coastal-800)] dark:text-white" />
          </Link>
          <div className="order-last w-full md:order-none md:w-auto md:flex-1">
            <CommandPalette />
          </div>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            <UserMenu
              name={user.name}
              email={user.email}
              photo={user.photo}
              role={user.role}
            />
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
        <KeyboardShortcuts />
      </div>
    </div>
  );
}
