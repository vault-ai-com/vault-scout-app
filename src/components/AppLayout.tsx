import { Suspense, useLayoutEffect } from "react";
import { Outlet, useLocation, NavLink } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LayoutDashboard, Users, LogOut, Search } from "lucide-react";

const InlineLoader = () => (
  <div className="flex-1 bg-background p-4 md:p-6 space-y-4">
    <div className="h-8 w-48 rounded-xl skeleton-shimmer" />
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="rounded-2xl p-5 bg-card border border-border">
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
];

const AppLayout = ({ onSignOut }: AppLayoutProps) => {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 -left-32 w-64 h-64 bg-primary/[0.03] rounded-full blur-[100px]" />
        <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-accent/[0.02] rounded-full blur-[100px]" />
      </div>

      <a href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-primary focus:text-primary-foreground focus:text-sm focus:font-medium">
        Hoppa till huvudinnehåll
      </a>

      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden md:flex w-[200px] flex-col border-r border-sidebar-border bg-sidebar-background">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 h-14 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Search className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="text-sm font-semibold text-sidebar-foreground tracking-tight">Vault Scout</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Huvudnavigation">
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-primary'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                }`
              }>
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Sign out */}
        <div className="px-3 py-4 border-t border-sidebar-border">
          <button type="button" onClick={onSignOut}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors">
            <LogOut className="w-4 h-4" />
            Logga ut
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="ml-0 md:ml-[200px] flex flex-col min-h-screen transition-all duration-200">
        {/* Mobile header */}
        <header className="md:hidden sticky top-0 z-20 h-14 flex items-center justify-between px-4 border-b border-border bg-background/80 backdrop-blur-lg">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <Search className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold text-foreground">Vault Scout</span>
          </div>
          <button type="button" onClick={onSignOut} className="text-muted-foreground p-2" aria-label="Logga ut">
            <LogOut className="w-4 h-4" />
          </button>
        </header>

        <main id="main-content" className="flex-1 pb-16 md:pb-0 relative" role="main" aria-label="Huvudinnehåll" tabIndex={-1}>
          <ErrorBoundary>
            <AnimatePresence mode="wait">
              <motion.div key={pathname}
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}>
                <Suspense fallback={<InlineLoader />}>
                  <Outlet />
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </ErrorBoundary>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 h-16 flex items-center justify-around border-t border-border bg-background/90 backdrop-blur-lg"
        aria-label="Mobilnavigation">
        {navItems.map(item => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`
            }>
            <item.icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div aria-live="polite" aria-atomic="true" className="sr-only" id="app-live-region" />
    </div>
  );
};

AppLayout.displayName = "AppLayout";

export { AppLayout };
