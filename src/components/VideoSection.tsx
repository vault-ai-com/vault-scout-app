import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Video, Plus, X, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  VideoEntrySchema,
  VideoEntriesSchema,
  extractYouTubeId,
  inferVideoType,
} from "@/lib/videoUtils";
import type { VideoEntry } from "@/lib/videoUtils";

const MAX_VIDEOS = 20;

interface VideoSectionProps {
  playerId: string;
  videos: VideoEntry[];
  onUpdate: () => void;
}

export function VideoSection({ playerId, videos, onUpdate }: VideoSectionProps) {
  const [urlInput, setUrlInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectedType = urlInput.trim() ? inferVideoType(urlInput.trim()) : null;

  async function persistVideos(next: VideoEntry[]) {
    setSaving(true);
    setError(null);
    const { error: dbError } = await supabase
      .from("scout_players")
      .update({ video_urls: next })
      .eq("id", playerId);
    setSaving(false);
    if (dbError) {
      setError(dbError.message);
      return false;
    }
    onUpdate();
    return true;
  }

  async function handleAdd() {
    const rawUrl = urlInput.trim();
    if (!rawUrl) return;

    if (videos.length >= MAX_VIDEOS) {
      setError(`Max ${MAX_VIDEOS} videos per spelare.`);
      return;
    }

    const candidate = {
      url: rawUrl,
      title: titleInput.trim() || undefined,
      type: inferVideoType(rawUrl),
      added_at: new Date().toISOString(),
    };

    const parsed = VideoEntrySchema.safeParse(candidate);
    if (!parsed.success) {
      setError("Ogiltig URL. Ange en fullständig URL (https://...).");
      return;
    }

    const next = [...videos, parsed.data];
    const validated = VideoEntriesSchema.safeParse(next);
    if (!validated.success) {
      setError("Valideringsfel. Kontrollera datan och försök igen.");
      return;
    }

    const ok = await persistVideos(validated.data);
    if (ok) {
      setUrlInput("");
      setTitleInput("");
    }
  }

  async function handleRemove(index: number) {
    const next = videos.filter((_, i) => i !== index);
    await persistVideos(next);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleAdd();
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="rounded-xl glass-premium card-accent-left p-6 md:p-8"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-8 h-8 rounded-lg icon-premium flex items-center justify-center">
          <Video className="w-4 h-4 text-primary" />
        </div>
        <span className="section-tag">Videor</span>
        {videos.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground/60 tabular-nums">
            {videos.length}/{MAX_VIDEOS}
          </span>
        )}
      </div>

      {/* Add video form */}
      <div className="space-y-2.5 mb-5">
        <div className="flex items-center gap-2">
          <input
            type="url"
            placeholder="YouTube-URL (https://youtu.be/...)"
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 px-3 py-2 rounded-lg bg-card/60 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
          />
          {detectedType && (
            <span className="text-[10px] px-2 py-1 rounded-md bg-card/60 border border-border/30 text-muted-foreground/70 whitespace-nowrap flex-shrink-0">
              {detectedType === "youtube" ? "YouTube" : detectedType === "vimeo" ? "Vimeo" : "Länk"}
            </span>
          )}
        </div>
        <input
          type="text"
          placeholder="Titel (valfritt)"
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full px-3 py-2 rounded-lg bg-card/60 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
        />
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={!urlInput.trim() || saving || videos.length >= MAX_VIDEOS}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground btn-premium disabled:opacity-50 shadow-md shadow-primary/20"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          Lägg till video
        </button>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-xs text-destructive mb-4 flex items-center gap-1.5"
            role="alert"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Video list */}
      {videos.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 py-2">Inga videor ännu.</p>
      ) : (
        <ul className="space-y-4">
          <AnimatePresence initial={false}>
            {videos.map((video, index) => (
              <VideoCard
                key={`${video.url}-${index}`}
                video={video}
                index={index}
                onRemove={handleRemove}
                saving={saving}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </motion.div>
  );
}

// --- VideoCard subcomponent ---

interface VideoCardProps {
  video: VideoEntry;
  index: number;
  onRemove: (index: number) => void;
  saving: boolean;
}

function VideoCard({ video, index, onRemove, saving }: VideoCardProps) {
  const youtubeId = video.type === "youtube" ? extractYouTubeId(video.url) : null;

  return (
    <motion.li
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2 }}
      className="rounded-lg bg-card/50 border border-border/30 overflow-hidden"
    >
      {/* YouTube embed */}
      {youtubeId ? (
        <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
          <iframe
            className="absolute inset-0 w-full h-full"
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
            title={video.title ?? `Video ${index + 1}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        </div>
      ) : null}

      {/* Footer row */}
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <div className="flex-1 min-w-0">
          {video.title ? (
            <p className="text-xs font-semibold text-foreground truncate">{video.title}</p>
          ) : (
            <p className="text-xs text-muted-foreground/60 truncate">{video.url}</p>
          )}
          <p className="text-[10px] text-muted-foreground/40 mt-0.5">
            {video.type === "youtube"
              ? "YouTube"
              : video.type === "vimeo"
              ? "Vimeo"
              : "Extern länk"}{" "}
            &middot;{" "}
            {new Date(video.added_at).toLocaleDateString("sv-SE", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Vimeo / other = external link, no embed */}
          {video.type !== "youtube" && (
            <a
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Öppna video i ny flik"
              className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-accent hover:bg-accent/10 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button
            type="button"
            onClick={() => onRemove(index)}
            disabled={saving}
            aria-label="Ta bort video"
            className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </motion.li>
  );
}
