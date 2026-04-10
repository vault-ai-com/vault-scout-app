import { z } from "zod";

// --- Zod schema ---

export const VideoEntrySchema = z.object({
  url: z.string().url().refine((u) => /^https?:\/\//i.test(u), {
    message: "Only http/https URLs allowed",
  }),
  title: z.string().optional(),
  type: z.enum(["youtube", "vimeo", "other"]),
  added_at: z.string(),
});

export type VideoEntry = z.infer<typeof VideoEntrySchema>;

export const VideoEntriesSchema = z.array(VideoEntrySchema);

// --- Utilities ---

/**
 * Extracts the YouTube video ID from a variety of URL formats.
 * Supports: youtu.be/ID, youtube.com/watch?v=ID, youtube.com/embed/ID,
 *           youtube.com/shorts/ID, youtube.com/v/ID
 * Returns null if the URL is not a recognizable YouTube URL.
 */
export function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split(/[?#]/)[0];
      return isValidYouTubeId(id) ? id : null;
    }

    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      // /watch?v=ID
      const v = parsed.searchParams.get("v");
      if (v && isValidYouTubeId(v)) return v;

      // /embed/ID, /shorts/ID, /v/ID
      const pathMatch = parsed.pathname.match(
        /^\/(embed|shorts|v)\/([A-Za-z0-9_-]{11})/,
      );
      if (pathMatch && isValidYouTubeId(pathMatch[2])) return pathMatch[2];
    }

    return null;
  } catch {
    return null;
  }
}

function isValidYouTubeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

/**
 * Infers the video platform from a URL.
 */
export function inferVideoType(url: string): "youtube" | "vimeo" | "other" {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "youtu.be" || host === "youtube.com" || host === "youtube-nocookie.com") {
      return "youtube";
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      return "vimeo";
    }
    return "other";
  } catch {
    return "other";
  }
}
