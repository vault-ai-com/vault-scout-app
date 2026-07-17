import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { authenticateRequest } from "../_shared/auth.ts";

// ---------------------------------------------------------------------------
// scout-set-tenant — switches the caller's active scout tenant.
// app_metadata is server-controlled (never client-writable), so the switch
// MUST happen here via the admin API. Membership is validated first, so a user
// can only ever switch to a tenant they are an active member of.
// ---------------------------------------------------------------------------

function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("Origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authResult = await authenticateRequest(req);
    if (!authResult.ok) {
      return json({ code: authResult.status, message: authResult.error }, authResult.status, corsHeaders);
    }
    // Switching is a per-user action; service-role/terminal has no single active tenant.
    if (authResult.isServiceRole) {
      return json({ code: 403, message: "User context required" }, 403, corsHeaders);
    }
    const userId = authResult.userId;

    const { tenant_id } = await req.json();
    if (!tenant_id || typeof tenant_id !== "string" || !isValidUUID(tenant_id)) {
      return json({ code: 400, message: "tenant_id must be a valid UUID" }, 400, corsHeaders);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceKey);

    // 1. Validate active membership BEFORE granting the switch.
    const { data: membership, error: mErr } = await admin
      .from("scout_tenant_members")
      .select("tenant_id")
      .eq("tenant_id", tenant_id)
      .eq("auth_user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (mErr) {
      return json({ code: 500, message: "Membership check failed" }, 500, corsHeaders);
    }
    if (!membership) {
      return json({ code: 403, message: "Not an active member of this tenant" }, 403, corsHeaders);
    }

    // 2. Merge into existing app_metadata (never clobber other claims).
    const { data: userRow, error: getErr } = await admin.auth.admin.getUserById(userId);
    if (getErr || !userRow?.user) {
      return json({ code: 500, message: "User lookup failed" }, 500, corsHeaders);
    }
    const mergedAppMeta = { ...(userRow.user.app_metadata ?? {}), tenant_id };

    // 3. Write the new active tenant into the server-controlled JWT source.
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: mergedAppMeta,
    });
    if (updErr) {
      return json({ code: 500, message: "Failed to set active tenant" }, 500, corsHeaders);
    }

    // Client must refreshSession() after this so the new JWT carries the claim.
    return json({ ok: true, tenant_id }, 200, corsHeaders);
  } catch (err) {
    console.error("scout-set-tenant error:", err);
    return json({ code: 500, message: "Internal error" }, 500, corsHeaders);
  }
});
