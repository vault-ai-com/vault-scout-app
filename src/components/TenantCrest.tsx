import { Search } from "lucide-react";
import { useTenant } from "@/hooks/use-tenant";

interface TenantCrestProps {
  size?: number;
  showName?: boolean;
  compact?: boolean;
}

function isSafeLogoUrl(url: string | null): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Tenant branding: logo (https only) with fallback to the gradient Search crest. */
export function TenantCrest({ size = 36, showName = true, compact = false }: TenantCrestProps) {
  const { currentTenant, isLoading } = useTenant();
  const name = currentTenant?.companyName || "Vault Scout";
  const logoUrl = currentTenant?.logoUrl ?? null;
  const px = `${size}px`;

  return (
    <div className="flex items-center gap-3" data-testid="tenant-crest">
      {isLoading ? (
        <div className="rounded-xl skeleton-shimmer" style={{ width: px, height: px }} aria-hidden="true" />
      ) : isSafeLogoUrl(logoUrl) ? (
        <img
          src={logoUrl}
          alt=""
          className="rounded-xl object-cover shadow-lg shadow-accent/20"
          style={{ width: px, height: px }}
        />
      ) : (
        <div
          className="rounded-xl bg-gradient-to-br from-accent to-success/70 flex items-center justify-center shadow-lg shadow-accent/20 shrink-0"
          style={{ width: px, height: px }}
          aria-hidden="true"
        >
          <Search className="text-accent-foreground" style={{ width: size * 0.42, height: size * 0.42 }} />
        </div>
      )}
      {showName && (
        <div className="flex flex-col min-w-0">
          <span className={`font-bold text-sidebar-foreground tracking-tight truncate ${compact ? "text-sm" : "text-sm"}`}>
            {name}
          </span>
          <span className="text-[10px] text-muted-foreground/50 font-medium tracking-wider uppercase">
            AI Scouting
          </span>
        </div>
      )}
    </div>
  );
}
