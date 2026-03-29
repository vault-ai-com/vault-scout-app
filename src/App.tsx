import { Suspense } from "react";
import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/hooks/use-auth";
import { lazyRetry } from "@/lib/lazy-retry";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

const Dashboard = lazyRetry(() => import("./pages/Dashboard"));
const Players = lazyRetry(() => import("./pages/Players"));
const PlayerDetail = lazyRetry(() => import("./pages/PlayerDetail"));
const BosseChat = lazyRetry(() => import("./pages/BosseChat"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 15 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
      retry: (failureCount, error) => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
        const msg = error instanceof Error ? error.message : '';
        if (msg.includes('42501') || msg.includes('row-level security')) return false;
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 15000),
    },
  },
});

const PageLoader = () => (
  <div className="flex items-center justify-center h-screen bg-background animate-in fade-in duration-300">
    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary opacity-60" />
  </div>
);

const AppRoutes = () => {
  const { isAuthenticated, loading, signIn, signOut } = useAuth();

  if (loading) return <PageLoader />;
  if (!isAuthenticated) return <Login onLogin={signIn} />;

  return (
    <Routes>
      <Route element={<AppLayout onSignOut={signOut} />}>
        <Route path="/" element={<ErrorBoundary fallbackMessage="Dashboard kunde inte laddas."><Dashboard /></ErrorBoundary>} />
        <Route path="/players" element={<ErrorBoundary fallbackMessage="Spelarlistan kunde inte laddas."><Players /></ErrorBoundary>} />
        <Route path="/players/:id" element={<ErrorBoundary fallbackMessage="Spelarprofilen kunde inte laddas."><PlayerDetail /></ErrorBoundary>} />
        <Route path="/chat" element={<ErrorBoundary fallbackMessage="Chatten kunde inte laddas."><BosseChat /></ErrorBoundary>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
};

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <Toaster richColors position="top-right" />
        <BrowserRouter basename={import.meta.env.BASE_URL?.replace(/\/$/, '') || ''}>
          <Suspense fallback={<PageLoader />}>
            <AppRoutes />
          </Suspense>
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
