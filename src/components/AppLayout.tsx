import { Suspense, useLayoutEffect, useState, useEffect } from "react";
import { Outlet, useLocation, NavLink } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LayoutDashboard, Users, LogOut, MessageCircle, Bot, GraduationCap, Search } from "lucide-react";
import { TenantCrest } from "@/components/TenantCrest";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { CommandPalette } from "@/components/CommandPalette";
import { SPRING_BOUNCY, EASE_OUT_QUART } from "@/lib/motion";

const InlineLoader = () => (
  <div className="flex-1 bg-background p-4 md:p-6 lg:p-8 space-y-4">
    <div className="h-8 w-48 rounded-xl skeleton-shimmer" />
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {[0, 1, 2].map(i => (
        <div key={i} className="rounded-xl p-5 glass-premium gradient-accent-top">
          <div className="h-3 w-20 rounded skeleton-shimmer mb-3" />
          <div className="h-8 w-24 rounded skeleton-shimmer mb-2" />
          <div className="h-3 w-16 rounded skeleton-shimmer" />
        </div>
      ))}
    </div>
  </div>
);

interface AppLayoutProps {
  onSignOut: () => void;
}

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/players", icon: Users, label: "Spelare" },
  { to: "/coaches", icon: GraduationCap, label: "Tränare" },
  { to: "/agents", icon: Bot, label: "Agenter" },
  { to: "/chat", icon: MessageCircle, label: "Bosse AI" },
];

const AppLayout = ({ onSignOut }: AppLayoutProps) => {
  const { pathname } = useLocation();
  const [cmdOpen, setCmdOpen] = useState(false);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);

  // Global ⌘K / Ctrl+K command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-24 -left-24 w-80 h-80 bg-accent/[0.04] rounded-full blur-[120px]" />
        <div className="absolute top-1/2 right-0 w-96 h-96 bg-success/[0.03] rounded-full blur-[140px]" />
        <div className="absolute -bottom-32 left-1/3 w-72 h-72 bg-accent/[0.03] rounded-full blur-[100px]" />
      </div>

      <a href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-accent focus:text-accent-foreground focus:text-sm focus:font-medium">
        Hoppa till huvudinnehåll
      </a>

      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden md:flex w-[220px] flex-col border-r border-border/30 sidebar-glass">
        {/* Logo / tenant crest */}
        <div className="flex items-center gap-3 px-5 h-16 border-b border-border/20">
          <TenantCrest size={36} showName />
        </div>
        {/* Tenant switcher (hidden when only one tenant) */}
        <TenantSwitcher variant="sidebar" />

        {/* Command palette trigger */}
        <div className="px-3 pt-1 pb-2">
          <button type="button" onClick={() => setCmdOpen(true)}
            aria-label="Öppna sök (Command K)"
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-sm text-sm text-sidebar-foreground/50 bg-sidebar-accent/40 border border-sidebar-border hover:text-sidebar-foreground hover:border-accent/40 transition-colors">
            <Search className="w-3.5 h-3.5" />
            <span className="flex-1 text-left">Sök</span>
            <kbd className="text-[10px] rounded-sm border border-sidebar-border px-1.5 py-0.5">⌘K</kbd>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-5 space-y-1" aria-label="Huvudnavigation">
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-colors duration-200 ${
                  isActive
                    ? 'bg-sidebar-accent text-accent'
                    : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                }`
              }>
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span layoutId="nav-indicator"
                      className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-accent"
                      style={{ boxShadow: "0 0 12px hsl(var(--accent) / 0.6)" }}
                      transition={SPRING_BOUNCY} />
                  )}
                  <item.icon className="w-4 h-4" strokeWidth={isActive ? 2.2 : 1.8} />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Sign out */}
        <div className="px-3 py-4 border-t border-border/20">
          <button type="button" onClick={onSignOut}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-all duration-200">
            <LogOut className="w-4 h-4" />
            Logga ut
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="ml-0 md:ml-[220px] flex flex-col min-h-screen transition-all duration-200">
        {/* Mobile header */}
        <header className="md:hidden sticky top-0 z-20 h-14 flex items-center justify-between px-4 border-b border-border/30 bg-background/90 backdrop-blur-xl">
          <TenantCrest size={32} showName />

          <button type="button" onClick={onSignOut} className="text-muted-foreground p-2 rounded-lg hover:bg-card transition-colors" aria-label="Logga ut">
            <LogOut className="w-4 h-4" />
          </button>
        </header>

        <main id="main-content" className="flex-1 pb-16 md:pb-0 relative" role="main" aria-label="Huvudinnehåll" tabIndex={-1}>
          <ErrorBoundary>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={pathname}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: EASE_OUT_QUART }}>
                <Suspense fallback={<InlineLoader />}>
                  <Outlet />
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </ErrorBoundary>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 h-16 flex items-center justify-around border-t border-border/30 bg-background/95 backdrop-blur-xl"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.25rem)' }}
        aria-label="Mobilnavigation">
        {navItems.map(item => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 px-5 py-1.5 rounded-xl transition-all duration-200 relative ${
                isActive ? 'text-accent' : 'text-muted-foreground'
              }`
            }>
            {({ isActive }) => (
              <>
                {isActive && <div className="absolute -top-1 w-8 h-[3px] bg-accent rounded-full" />}
                <item.icon className={`w-5 h-5 transition-transform duration-200 ${isActive ? 'scale-110' : ''}`} />
                <span className="text-[10px] font-semibold">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

      <div aria-live="polite" aria-atomic="true" className="sr-only" id="app-live-region" />
    </div>
  );
};

AppLayout.displayName = "AppLayout";

export { AppLayout };
