import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, AlertCircle, Eye, EyeOff, Sparkles, Search } from "lucide-react";

interface LoginProps {
  onLogin: (email: string, password: string) => Promise<unknown>;
}

const Login = ({ onLogin }: LoginProps) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onLogin(email, password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg === "Invalid login credentials"
          ? "Fel e-post eller lösenord"
          : msg || "Inloggning misslyckades"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background overflow-hidden">
      {/* Ambient blobs */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.15) 0%, transparent 70%)', filter: 'blur(80px)' }} />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, hsl(var(--accent) / 0.12) 0%, transparent 70%)', filter: 'blur(80px)' }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.06) 0%, transparent 70%)', filter: 'blur(60px)' }} />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0.5 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
            className="mx-auto mb-5 w-[72px] h-[72px] rounded-2xl bg-primary flex items-center justify-center"
          >
            <Search className="w-8 h-8 text-primary-foreground" />
          </motion.div>
          <h1 className="text-xl font-bold text-foreground">Vault AI Scout</h1>
          <p className="text-sm mt-2 text-muted-foreground">
            Logga in för att börja scouta
          </p>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-xl p-6 space-y-4"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <div>
              <label htmlFor="login-email" className="block text-xs font-medium mb-1.5 text-muted-foreground">
                E-post
              </label>
              <input id="login-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="namn@example.com" required autoFocus autoComplete="email"
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all bg-input border border-border text-foreground" />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-medium mb-1.5 text-muted-foreground">
                Lösenord
              </label>
              <div className="relative">
                <input id="login-password" type={showPassword ? "text" : "password"} value={password}
                  onChange={e => setPassword(e.target.value)} required autoComplete="current-password"
                  className="w-full px-3 py-2.5 pr-10 rounded-lg text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all bg-input border border-border text-foreground" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div aria-live="polite">
              {error && (
                <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 text-xs p-2.5 rounded-lg bg-destructive/10 text-destructive border border-destructive/20" role="alert">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  {error}
                </motion.div>
              )}
            </div>

            <button type="submit" disabled={loading || !email || !password}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(260 65% 60%))' }}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Logga in"}
            </button>
          </div>
        </form>

        {/* Powered by */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8, duration: 0.5 }}>
          <div className="flex items-center justify-center gap-1.5 mt-6 opacity-40 hover:opacity-80 transition-opacity">
            <Sparkles className="w-3 h-3 text-primary" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-primary/60">
              Powered by Vault AI
            </span>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default Login;
