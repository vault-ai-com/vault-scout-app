import { z } from "zod";

// --- Chat session schema ---
export const ChatSessionSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  title: z.string().nullable(),
  player_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  message_count: z.number(),
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;

// --- Chat message schema ---
export const ChatMessageSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// --- Zod helpers (re-export from scout.ts pattern) ---
export function safeChatArray<T>(schema: z.ZodType<T>, data: unknown): T[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const result = schema.safeParse(item);
    return result.success ? [result.data] : [];
  });
}
