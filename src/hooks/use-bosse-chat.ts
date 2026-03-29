import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChatSessionSchema, ChatMessageSchema, safeChatArray } from "@/types/chat";
import type { ChatSession, ChatMessage } from "@/types/chat";

// --- Session queries ---
export function useChatSessions() {
  return useQuery<ChatSession[]>({
    queryKey: ["bosse-chat-sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scout_chat_sessions")
        .select("*")
        .order("updated_at", { ascending: false });
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
  return useMutation<ChatSession, Error, { title?: string; player_id?: string }>({
    mutationFn: async ({ title, player_id }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("scout_chat_sessions")
        .insert({ user_id: session.user.id, title: title ?? null, player_id: player_id ?? null })
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
}

export function useSendMessage() {
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const qc = useQueryClient();

  const send = useCallback(async ({ message, sessionId, playerId }: SendMessageArgs): Promise<string> => {
    setStreaming(true);
    setStreamContent("");
    abortRef.current = new AbortController();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const url = `${import.meta.env.VITE_SUPABASE_URL ?? "https://czyzohfllffpgctslbwk.supabase.co"}/functions/v1/scout-bosse-chat`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ message, session_id: sessionId, player_id: playerId }),
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

          try {
            const evt = JSON.parse(payload);
            if (evt.type === "content_block_delta" && evt.delta?.text) {
              fullContent += evt.delta.text;
              setStreamContent(fullContent);
            } else if (evt.type === "error") {
              throw new Error(evt.error || "Stream error");
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }

      // Invalidate messages + sessions (for updated_at / message_count)
      qc.invalidateQueries({ queryKey: ["bosse-chat-messages", sessionId] });
      qc.invalidateQueries({ queryKey: ["bosse-chat-sessions"] });

      return fullContent;
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [qc]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, abort, streaming, streamContent };
}
