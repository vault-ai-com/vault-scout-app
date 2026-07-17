import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useTenant } from "@/hooks/use-tenant";

/** Dropdown to switch active tenant. Hidden when the user belongs to ≤1 tenant. */
export function TenantSwitcher({ variant = "sidebar" }: { variant?: "sidebar" | "mobile" }) {
  const { currentTenant, availableTenants, switchTenant, isSwitching } = useTenant();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (availableTenants.length <= 1) return null;

  const label = currentTenant?.companyName || "Välj organisation";

  const handleSelect = async (tenantId: string) => {
    setOpen(false);
    if (tenantId !== currentTenant?.tenantId) {
      await switchTenant(tenantId);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${variant === "sidebar" ? "px-3 pb-3" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isSwitching}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Byt organisation"
        data-testid="tenant-switcher-trigger"
        className="flex items-center gap-2 w-full min-h-11 px-3 py-2 rounded-sm text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors disabled:opacity-60"
      >
        {isSwitching ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : null}
        <span className="truncate flex-1 text-left">{label}</span>
        <ChevronsUpDown className="w-4 h-4 shrink-0 opacity-60" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Organisationer"
          className="absolute left-3 right-3 z-40 mt-1 rounded-sm border border-border/40 bg-popover shadow-xl overflow-hidden"
        >
          {availableTenants.map((t) => {
            const active = t.tenantId === currentTenant?.tenantId;
            return (
              <button
                key={t.tenantId}
                type="button"
                role="menuitem"
                aria-current={active ? "true" : undefined}
                onClick={() => handleSelect(t.tenantId)}
                className="flex items-center gap-2 w-full min-h-11 px-3 py-2 text-sm text-left text-popover-foreground hover:bg-sidebar-accent/60 transition-colors"
              >
                <span className="truncate flex-1">{t.companyName}</span>
                {active && <Check className="w-4 h-4 shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
