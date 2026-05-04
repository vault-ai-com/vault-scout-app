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
 * Authenticate a request via JWT or service-role key.
 * - Service-role key: compared against SUPABASE_SERVICE_ROLE_KEY env var.
 *   Used by terminal pipeline (Python → edge fn).
 * - User JWT: validated via supabase auth.getUser()
 *
 * P0-1 fix: Previously decoded JWT payload and trusted role claim without
 * cryptographic verification. Now compares the full token against the known
 * service-role key. A forged JWT with role=service_role no longer bypasses auth.
 */
export async function authenticateRequest(
  req: Request,
): Promise<AuthResult | AuthError> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, error: "Missing or invalid Authorization header", status: 401 };
  }

  const token = authHeader.replace("Bearer ", "");

  // Service-role key detection: compare full token against known secret(s)
  // Supabase runtime has new sb_secret_ key; terminal may send legacy JWT key.
  // Both are checked via exact string match (no JWT payload trust).
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const legacyServiceKey = Deno.env.get("LEGACY_SERVICE_ROLE_KEY") ?? "";
  if (serviceRoleKey && token === serviceRoleKey) {
    return { ok: true, userId: "terminal-pipeline", isServiceRole: true };
  }
  if (legacyServiceKey && token === legacyServiceKey) {
    return { ok: true, userId: "terminal-pipeline", isServiceRole: true };
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
