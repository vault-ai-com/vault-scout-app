import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Video, Plus, X, ExternalLink, Loader2, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/supabase/client";
import {
  VideoEntrySchema,
  VideoEntriesSchema,
  extractYouTubeId,
  extractVimeoId,
  fetchOEmbedMetadata,
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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

    const candidate: VideoEntry = {
      id: crypto.randomUUID(),
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

      // Fire-and-forget oEmbed fetch — never blocks handleAdd
      if (parsed.data.title === undefined) {
        void (async () => {
          try {
            const meta = await fetchOEmbedMetadata(parsed.data.url);
            if (!meta) return;

            // Re-read latest list from DB to avoid stale closure
            const { data: fresh } = await supabase
              .from("scout_players")
              .select("video_urls")
              .eq("id", playerId)
              .single();

            if (!fresh?.video_urls) return;

            const freshVideos = VideoEntriesSchema.safeParse(fresh.video_urls);
            if (!freshVideos.success) return;

            const updatedList = freshVideos.data.map((v) => {
              if (v.id === parsed.data.id) {
                return {
                  ...v,
                  title: v.title ?? meta.title,
                  thumbnail_url: v.thumbnail_url ?? meta.thumbnail_url,
                };
              }
              return v;
            });

            const { error: metaErr } = await supabase
              .from("scout_players")
              .update({ video_urls: updatedList })
              .eq("id", playerId);

            if (!metaErr) onUpdate();
          } catch {
            // oEmbed failure is non-fatal — silently ignored
          }
        })();
      }
    }
  }

  async function handleRemove(id: string) {
    const next = videos.filter((v) => v.id !== id);
    await persistVideos(next);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = videos.findIndex((v) => v.id === active.id);
    const newIndex = videos.findIndex((v) => v.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(videos, oldIndex, newIndex);
    await persistVideos(reordered);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleAdd();
    }
  }

  // Assign stable IDs to any legacy entries that lack one (backward compat)
  const videosWithIds: Array<Omit<VideoEntry, "id"> & { id: string }> = videos.map((v) =>
    v.id
      ? (v as Omit<VideoEntry, "id"> & { id: string })
      : { ...v, id: `legacy-${v.url}-${v.added_at}` },
  );
  const sortableIds = videosWithIds.map((v) => v.id);

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
            placeholder="YouTube- eller Vimeo-URL (https://...)"
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
              {detectedType === "youtube"
                ? "YouTube"
                : detectedType === "vimeo"
                ? "Vimeo"
                : "Länk"}
            </span>
          )}
        </div>
        <input
          type="text"
          placeholder="Titel (valfritt — hämtas automatiskt)"
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
      {videosWithIds.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 py-2">Inga videor ännu.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <ul className="space-y-4">
              <AnimatePresence mode="popLayout" initial={false}>
                {videosWithIds.map((video) => (
                  <SortableVideoCard
                    key={video.id}
                    video={video}
                    onRemove={handleRemove}
                    saving={saving}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </motion.div>
  );
}

// --- SortableVideoCard ---

interface SortableVideoCardProps {
  video: Omit<VideoEntry, "id"> & { id: string };
  onRemove: (id: string) => void;
  saving: boolean;
}

function SortableVideoCard({ video, onRemove, saving }: SortableVideoCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: video.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const youtubeId = video.type === "youtube" ? extractYouTubeId(video.url) : null;
  const vimeoId = video.type === "vimeo" ? extractVimeoId(video.url) : null;

  return (
    <motion.li
      ref={setNodeRef}
      style={style}
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2 }}
      className="rounded-lg bg-card/50 border border-border/30 overflow-hidden"
    >
      {/* YouTube embed */}
      {youtubeId && (
        <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
          <iframe
            className="absolute inset-0 w-full h-full"
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
            title={video.title ?? video.url}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        </div>
      )}

      {/* Vimeo embed */}
      {vimeoId && (
        <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
          <iframe
            className="absolute inset-0 w-full h-full"
            src={`https://player.vimeo.com/video/${vimeoId}?title=0&byline=0&portrait=0`}
            title={video.title ?? video.url}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        </div>
      )}

      {/* Thumbnail fallback for "other" type */}
      {video.type === "other" && video.thumbnail_url && (
        <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
          <img
            src={video.thumbnail_url}
            alt={video.title ?? "Video thumbnail"}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        {/* Drag handle */}
        <button
          type="button"
          aria-label="Dra för att ändra ordning"
          className="flex-shrink-0 p-1 rounded text-muted-foreground/30 hover:text-muted-foreground/60 cursor-grab active:cursor-grabbing transition-colors touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>

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
          {/* External link for non-embed types */}
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
            onClick={() => onRemove(video.id)}
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
