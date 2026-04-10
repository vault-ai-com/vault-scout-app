import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
import { ChatSessionSchema, ChatMessageSchema, safeChatArray } from "@/types/chat";
import type { ChatSession, ChatMessage } from "@/types/chat";

// --- Session queries ---
export function useChatSessions(agentId?: string | null) {
  return useQuery<ChatSession[]>({
    queryKey: ["bosse-chat-sessions", agentId ?? "bosse"],
    queryFn: async () => {
      let query = supabase
        .from("scout_chat_sessions")
        .select("*")
        .order("updated_at", { ascending: false });

      if (agentId) {
        query = query.eq("agent_id", agentId);
      } else {
        query = query.is("agent_id", null);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return safeChatArray(ChatSessionSchema, data);
    },
    staleTime: 30_000,
  });
}

export function useChatMessages(sessionId: string | null) {
  return useQuery<ChatMessage[]>({
    queryKey: ["bosse-chat-messages", sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const { data, error } = await supabase
        .from("scout_chat_messages")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return safeChatArray(ChatMessageSchema, data);
    },
    enabled: !!sessionId,
    staleTime: 10_000,
  });
}

// --- Create session ---
export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation<ChatSession, Error, { title?: string; player_id?: string; agent_id?: string | null }>({
    mutationFn: async ({ title, player_id, agent_id }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("scout_chat_sessions")
        .insert({
          user_id: session.user.id,
          title: title ?? null,
          player_id: player_id ?? null,
          agent_id: agent_id ?? null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const parsed = ChatSessionSchema.safeParse(data);
      if (!parsed.success) throw new Error("Invalid session response");
      return parsed.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bosse-chat-sessions"] }),
  });
}

// --- Delete session ---
export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (sessionId) => {
      const { error } = await supabase
        .from("scout_chat_sessions")
        .delete()
        .eq("id", sessionId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bosse-chat-sessions"] }),
  });
}

// --- Streaming send message ---
interface SendMessageArgs {
  message: string;
  sessionId: string;
  playerId?: string;
  agentId?: string | null;
}

export function useSendMessage() {
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingContentRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const qc = useQueryClient();

  const flushPending = useCallback(() => {
    rafRef.current = null;
    if (pendingContentRef.current !== null) {
      setStreamContent(pendingContentRef.current);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const send = useCallback(async ({ message, sessionId, playerId, agentId }: SendMessageArgs): Promise<string> => {
    setStreaming(true);
    setStreamContent("");
    setError(null);
    pendingContentRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    abortRef.current = new AbortController();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const url = `${SUPABASE_URL}/functions/v1/scout-bosse-chat`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ message, session_id: sessionId, player_id: playerId, agent_id: agentId ?? undefined }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Chat failed: ${res.status} ${err}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;

          let evt: { type?: string; delta?: { text?: string }; error?: string };
          try {
            evt = JSON.parse(payload);
          } catch {
            // Skip unparseable SSE lines
            continue;
          }
          if (evt.type === "content_block_delta" && evt.delta?.text) {
            fullContent += evt.delta.text;
            pendingContentRef.current = fullContent;
            if (rafRef.current === null) {
              rafRef.current = requestAnimationFrame(flushPending);
            }
          } else if (evt.type === "error") {
            throw new Error(evt.error || "Stream error");
          }
        }
      }

      // Invalidate messages + sessions (for updated_at / message_count)
      qc.invalidateQueries({ queryKey: ["bosse-chat-messages", sessionId] });
      qc.invalidateQueries({ queryKey: ["bosse-chat-sessions"] });

      return fullContent;
    } catch (err) {
      // Intentional abort is not an error
      if (err instanceof DOMException && err.name === "AbortError") {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        pendingContentRef.current = null;
        setStreamContent("");
        return "";
      }
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (pendingContentRef.current !== null) {
        setStreamContent(pendingContentRef.current);
        pendingContentRef.current = null;
      }
      setStreaming(false);
      abortRef.current = null;
    }
  }, [qc, flushPending]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, abort, streaming, streamContent, error };
}
