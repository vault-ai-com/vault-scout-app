import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://vault-scout-app.vercel.app",
  "https://vaultai.se",
  "https://www.vaultai.se",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:5174",
];

function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin =
    requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)
      ? requestOrigin
      : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("Origin"));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ code: 401, message: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const supabaseAnon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ code: 401, message: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse body
    const { message, session_id, player_id } = await req.json();
    if (!message || !session_id) {
      return new Response(JSON.stringify({ code: 400, message: "Missing message or session_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof session_id !== "string" || !isValidUUID(session_id)) {
      return new Response(JSON.stringify({ code: 400, message: "session_id must be a valid UUID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (player_id != null && (typeof player_id !== "string" || !isValidUUID(player_id))) {
      return new Response(JSON.stringify({ code: 400, message: "player_id must be a valid UUID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify session ownership
    const { data: session, error: sessionError } = await supabase
      .from("scout_chat_sessions")
      .select("id, user_id")
      .eq("id", session_id)
      .single();
    if (sessionError || !session || session.user_id !== user.id) {
      return new Response(JSON.stringify({ code: 403, message: "Session not found or not owned" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save user message
    await supabase.from("scout_chat_messages").insert({
      session_id,
      role: "user",
      content: message,
    });

    // Load Bosse persona
    let personaText = "Du är Bosse Andersson, en erfaren fotbollsscout med 30+ års erfarenhet från svensk och europeisk fotboll. Du har djup kunskap om spelarutveckling, taktik, transfermarknaden och scoutingmetodik. Du är DIF-supporter i grunden men analyserar objektivt. Du talar svenska, är direkt och ärlig men varm. Du delar gärna med dig av dina erfarenheter och anekdoter.";
    try {
      const { data: personaChunks } = await supabase.rpc("get_clone_persona_safe", {
        p_clone_id: "clone_bosse_andersson",
      });
      if (personaChunks && Array.isArray(personaChunks) && personaChunks.length > 0) {
        personaText = personaChunks.map((c: { chunk_text: string }) => c.chunk_text).join("\n");
      }
    } catch {
      // Use fallback persona
    }

    // Load scout KB context
    let kbContext = "";
    try {
      const { data: kbEntries } = await supabase
        .from("knowledge_bank")
        .select("title, category, content")
        .eq("cluster", "vault_ai_scout")
        .limit(8);
      if (kbEntries && kbEntries.length > 0) {
        kbContext = "\n\n## Scout Knowledge Base\n" +
          kbEntries.map((e: { title: string; category: string; content: unknown }) =>
            `### ${e.title} (${e.category})\n${typeof e.content === 'string' ? e.content.slice(0, 3000) : JSON.stringify(e.content).slice(0, 3000)}`
          ).join("\n\n");
      }
    } catch {
      // Skip KB
    }

    // Load player context if provided
    let playerContext = "";
    if (player_id) {
      try {
        const { data: player } = await supabase
          .from("scout_players")
          .select("*")
          .eq("id", player_id)
          .single();
        if (player) {
          playerContext = `\n\n## Aktuell spelare\nNamn: ${player.name}\nPosition: ${player.position_primary}\nKlubb: ${player.current_club}\nLiga: ${player.current_league}\nNationalitet: ${player.nationality}\nTier: ${player.tier}\nKarrärfas: ${player.career_phase}`;
        }
      } catch {
        // Skip player
      }
    }

    // Load session history (last 20 messages)
    const { data: history } = await supabase
      .from("scout_chat_messages")
      .select("role, content")
      .eq("session_id", session_id)
      .order("created_at", { ascending: true })
      .limit(20);

    const messages = [
      {
        role: "user",
        content: `${personaText}${kbContext}${playerContext}\n\nViktig instruktion: Du svarar ALLTID på svenska. Du är Bosse Andersson — tala som dig själv, inte som en AI. Var personlig, direkt och dela gärna anekdoter och erfarenheter. Håll svar lagom långa (max 300 ord om inte användaren ber om mer).`,
      },
      ...(history ?? []).map((m: { role: string; content: string }) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    ];

    // Call Claude API with streaming
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: 4096,
        stream: true,
        messages,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error("Claude API error:", claudeRes.status, errText);
      return new Response(JSON.stringify({ code: 502, message: "Claude API error" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const reader = claudeRes.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    // ReadableStream pull pattern (NOT TransformStream — broken in SupabaseEdgeRuntime)
    const stream = new ReadableStream({
      async pull(ctrl) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            // Post-stream: save assistant message + update session
            if (fullContent) {
              await supabase.from("scout_chat_messages").insert({
                session_id,
                role: "assistant",
                content: fullContent,
              });
              await supabase
                .from("scout_chat_sessions")
                .update({
                  updated_at: new Date().toISOString(),
                  message_count: (history?.length ?? 0) + 2,
                })
                .eq("id", session_id);
            }
            ctrl.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            ctrl.close();
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;

            try {
              const evt = JSON.parse(payload);
              if (evt.type === "content_block_delta" && evt.delta?.text) {
                fullContent += evt.delta.text;
              }
            } catch {
              // Skip
            }

            ctrl.enqueue(new TextEncoder().encode(line + "\n"));
          }
        } catch (err) {
          console.error("Stream error:", err);
          ctrl.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    console.error("Function error:", err);
    return new Response(JSON.stringify({ code: 500, message: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
