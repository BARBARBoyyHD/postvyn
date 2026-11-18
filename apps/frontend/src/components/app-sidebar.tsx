"use client";

/**
 * The signed-in chrome: navigation, the active brand, and the publishing switch.
 *
 * Client only because the active item comes from `usePathname`. Every value — session-derived role,
 * workspace settings, the brand list — arrives as a prop from the server layout; nothing about the
 * session is read here.
 *
 * The surface carries the gradient: a warm near-black at the logo fading to the page's own bg0, with
 * accent-tinted pills for the current route. The content area below keeps the brand palette.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Cable,
  ClipboardCheck,
  Inbox,
  LayoutDashboard,
  PenLine,
  Tags,
} from "lucide-react";

import { BrandSwitcher } from "@/components/brand-switcher";
import { PublishingState } from "@/components/publishing-state";
import { SignOutButton } from "@/components/sign-out-button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const LINKS = [
  { href: "/board", label: "the board", icon: LayoutDashboard },
  { href: "/review", label: "needs you", icon: ClipboardCheck },
  { href: "/compose", label: "make a post", icon: PenLine },
  { href: "/intake", label: "drop stuff", icon: Inbox },
  { href: "/brands", label: "your brands", icon: Tags },
  { href: "/channels", label: "connections", icon: Cable },
  { href: "/health", label: "status", icon: Activity },
] as const;

const ACTIVE_ITEM =
  "font-mono text-[11px] tracking-[0.14em] data-[active=true]:bg-linear-to-r data-[active=true]:from-zavron-accent/25 data-[active=true]:via-zavron-accent/10 data-[active=true]:to-transparent data-[active=true]:text-zavron-ink";

interface AppSidebarProps {
  brands: { id: string; slug: string; name: string; colors: string | null }[];
  activeBrandId: string | null;
  role: string;
  globalEnabled: boolean;
  workspaceEnabled: boolean;
}

export function AppSidebar({
  brands,
  activeBrandId,
  role,
  globalEnabled,
  workspaceEnabled,
}: AppSidebarProps) {
  const pathname = usePathname();

  // `/posts/...` belongs to the board: it is where a post is opened from, and it has no nav item.
  function isActive(href: string): boolean {
    if (href === "/board") return pathname === "/board" || pathname.startsWith("/posts");
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <div className="flex h-full min-h-0 flex-col bg-linear-to-b from-[#15100c] via-[#0f0e0d] to-[#0b0b0b]">
        <SidebarHeader className="border-b border-sidebar-border/70 px-3 py-3 group-data-[collapsible=icon]:px-1.5">
          <div className="flex items-center gap-2">
            <Link
              href="/board"
              className="flex items-baseline gap-2 group-data-[collapsible=icon]:hidden"
            >
              <span className="text-sm font-semibold tracking-tight text-zavron-ink">Postvyn</span>
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-linear-to-br from-zavron-accent to-zavron-accent-soft shadow-[0_0_12px_-1px_#ff4d12]"
              />
            </Link>
            <SidebarTrigger className="ml-auto text-zavron-muted hover:text-zavron-ink group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:ml-0" />
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="font-mono text-[10px] tracking-[0.18em] text-zavron-muted">
              your workspace
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {LINKS.map((link) => {
                  const Icon = link.icon;
                  return (
                    <SidebarMenuItem key={link.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive(link.href)}
                        tooltip={link.label}
                        className={ACTIVE_ITEM}
                      >
                        <Link href={link.href}>
                          <Icon />
                          <span>{link.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="gap-3 border-t border-sidebar-border/70 bg-linear-to-t from-zavron-bg0/80 to-transparent px-3 py-3 group-data-[collapsible=icon]:hidden">
          <div className="min-w-0 overflow-hidden">
            <BrandSwitcher brands={brands} activeBrandId={activeBrandId} />
          </div>

          <PublishingState globalEnabled={globalEnabled} workspaceEnabled={workspaceEnabled} />

          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zavron-muted">
              {role}
            </span>
            <SignOutButton />
          </div>
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}
