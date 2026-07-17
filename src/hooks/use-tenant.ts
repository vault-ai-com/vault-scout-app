import { useContext } from "react";
import { TenantContext } from "@/providers/tenant-context";

/** Access the active scout tenant. Throws if used outside <TenantProvider>. */
export function useTenant() {
  const ctx = useContext(TenantContext);
  if (ctx === undefined) {
    throw new Error("useTenant must be used within a TenantProvider");
  }
  return ctx;
}
