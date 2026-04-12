// ---------------------------------------------------------------------------
// Shared auth helper for scout edge functions
// Supports: (1) User JWT (webapp), (2) Service-role key (terminal pipeline)
// ---------------------------------------------------------------------------
import { createClient } from "jsr:@supabase/supabase-js@2";

export interface AuthResult {
  ok: true;
  userId: string;
  isServiceRole: boolean;
}

export interface AuthError {
  ok: false;
  error: string;
  status: number;
}

/**
 * Authenticate a request via JWT.
 * - User JWT: validates via supabase auth.getUser()
 * - Service-role key: detected by JWT payload role === 'service_role'
 *   Used by terminal pipeline (Python → edge fn). Safe because service_role
 *   key is never exposed client-side.
 */
export async function authenticateRequest(
  req: Request,
): Promise<AuthResult | AuthError> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, error: "Missing or invalid Authorization header", status: 401 };
  }

  const token = authHeader.replace("Bearer ", "");

  // Decode JWT payload (no verification — gateway already verified if verify_jwt=true)
  try {
    const raw = token.split(".")[1];
    if (raw) {
      // Convert base64url → base64 (JWT uses url-safe alphabet without padding)
      const b64 = raw.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (raw.length % 4)) % 4);
      const payload = JSON.parse(atob(b64));
      if (payload.role === "service_role") {
        return { ok: true, userId: "terminal-pipeline", isServiceRole: true };
      }
    }
  } catch {
    // Not a valid JWT structure — fall through to user auth
  }

  // Standard user JWT authentication
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) {
      return { ok: false, error: "Unauthorized", status: 401 };
    }
    return { ok: true, userId: user.id, isServiceRole: false };
  } catch {
    return { ok: false, error: "Authentication failed", status: 401 };
  }
}
