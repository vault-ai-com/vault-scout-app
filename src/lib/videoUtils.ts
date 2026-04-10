import { z } from "zod";

// --- Zod schema ---

export const VideoEntrySchema = z.object({
  id: z.string().optional(),
  url: z.string().url().refine((u) => /^https?:\/\//i.test(u), {
    message: "Only http/https URLs allowed",
  }),
  title: z.string().optional(),
  type: z.enum(["youtube", "vimeo", "other"]),
  added_at: z.string(),
  thumbnail_url: z.string().url().optional(),
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
 * Extracts the Vimeo video ID from a variety of URL formats.
 * Supports: vimeo.com/{ID}, vimeo.com/channels/x/{ID}, vimeo.com/groups/x/videos/{ID},
 *           player.vimeo.com/video/{ID}
 * Returns null if the URL is not a recognizable Vimeo URL.
 */
export function extractVimeoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;

    // player.vimeo.com/video/ID
    const playerMatch = parsed.pathname.match(/^\/video\/(\d+)/);
    if (playerMatch) return playerMatch[1];

    // vimeo.com/ID (direct)
    const directMatch = parsed.pathname.match(/^\/(\d+)/);
    if (directMatch) return directMatch[1];

    // vimeo.com/channels/*/ID or vimeo.com/groups/*/videos/ID
    const channelMatch = parsed.pathname.match(/\/(\d+)(?:$|\/|#)/);
    if (channelMatch) return channelMatch[1];

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetches oEmbed metadata for a video URL (YouTube or Vimeo).
 * Returns { title, thumbnail_url } or null on failure.
 * Non-blocking — caller must not await this in the critical path.
 */
export async function fetchOEmbedMetadata(
  url: string,
): Promise<{ title: string; thumbnail_url: string } | null> {
  try {
    const type = inferVideoType(url);
    let oembedUrl: string;

    if (type === "youtube") {
      oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    } else if (type === "vimeo") {
      oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
    } else {
      return null;
    }

    const res = await fetch(oembedUrl);
    if (!res.ok) return null;

    const data = (await res.json()) as {
      title?: string;
      thumbnail_url?: string;
    };

    if (!data.title || !data.thumbnail_url) return null;

    return { title: data.title, thumbnail_url: data.thumbnail_url };
  } catch {
    return null;
  }
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
