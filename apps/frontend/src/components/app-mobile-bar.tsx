/**
 * The `< md` chrome: the drawer's trigger plus the one control that must stay one tap away.
 *
 * A server component on purpose — the trigger and the switcher are client components, but nothing
 * here needs state, and the brand list is already resolved by the layout.
 */
import { BrandSwitcher } from "@/components/brand-switcher";
import { SidebarTrigger } from "@/components/ui/sidebar";

interface AppMobileBarProps {
  brands: { id: string; slug: string; name: string; colors: string | null }[];
  activeBrandId: string | null;
}

export function AppMobileBar({ brands, activeBrandId }: AppMobileBarProps) {
  return (
    <div className="flex items-center gap-3 border-b border-zavron-line/70 bg-zavron-bg0/90 px-4 py-2 md:hidden">
      <SidebarTrigger className="text-zavron-muted hover:text-zavron-ink" />
      <span className="text-sm font-semibold tracking-tight text-zavron-ink">
        Postvyn<span className="text-zavron-accent">.</span>
      </span>
      <div className="ml-auto min-w-0">
        <BrandSwitcher brands={brands} activeBrandId={activeBrandId} />
      </div>
    </div>
  );
}
