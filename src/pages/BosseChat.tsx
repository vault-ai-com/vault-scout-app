import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ArrowDown,
  History,
  Loader2,
  MessageCircle,
  Plus,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useChatSessions,
  useChatMessages,
  useCreateSession,
  useDeleteSession,
  useSendMessage,
} from "@/hooks/use-bosse-chat";
import { useScrollAnchor } from "@/hooks/use-scroll-anchor";
import { BosseAvatar, ChatBubble, StreamingBubble, ThinkingBubble } from "@/components/chat";
import { SPRING_BOUNCY, SPRING_SNAPPY } from "@/lib/motion";
import type { ChatMessage, ChatSession } from "@/types/chat";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  "Analysera en spelare i truppen",
  "Jämför två spelare mot varandra",
  "Vilka svagheter har nästa motståndare?",
  "Hur bedömer du unga spelare från Superettan?",
] as const;

const GROUP_ORDER = ["Idag", "Igår", "Denna vecka", "Tidigare"] as const;
type GroupLabel = (typeof GROUP_ORDER)[number];

function groupLabelFor(iso: string): GroupLabel {
  const then = new Date(iso);
  const now = new Date();
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((dayStart(now) - dayStart(then)) / 86_400_000);
  if (diffDays <= 0) return "Idag";
  if (diffDays === 1) return "Igår";
  if (diffDays < 7) return "Denna vecka";
  return "Tidigare";
}

/** Defensive extraction of source references from message metadata. */
function extractSources(metadata: ChatMessage["metadata"]): string[] {
  if (!metadata) return [];
  const raw = metadata["sources"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string").slice(0, 4);
}

const INPUT_BASE_HEIGHT = "44px";
const ABORT_REVEAL_DELAY_MS = 2000;
/** Only the last N messages get a motion wrapper (perf). */
const ANIMATED_TAIL = 3;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const BosseChat = () => {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAbort, setShowAbort] = useState(false);
  /** Optimistic echo of the just-sent user message until the refetch lands. */
  const [pendingUser, setPendingUser] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendStartedAtRef = useRef(0);
  const sessionSwitchRef = useRef(false);

  const qc = useQueryClient();
  const { data: sessions = [], isLoading: loadingSessions } = useChatSessions();
  const {
    data: messages = [],
    isLoading: loadingMessages,
    dataUpdatedAt,
  } = useChatMessages(activeSessionId);
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();
  const { send, streaming, streamContent, abort, error } = useSendMessage();

  const { containerRef, isAnchored, hasNewBelow, scrollToBottom, notifyNewContent } =
    useScrollAnchor();

  // --- Derived state -------------------------------------------------------

  const groupedSessions = useMemo(() => {
    const map: Record<GroupLabel, ChatSession[]> = {
      Idag: [],
      Igår: [],
      "Denna vecka": [],
      Tidigare: [],
    };
    for (const s of sessions) map[groupLabelFor(s.updated_at)].push(s);
    return map;
  }, [sessions]);

  const showEmptyState =
    !streaming && pendingUser === null && !loadingMessages && messages.length === 0;

  /** Keep the streamed reply visible until the persisted copy has landed. */
  const showStreamEcho = streamContent.length > 0 && (streaming || pendingUser !== null);

  // --- Effects --------------------------------------------------------------

  // Drop the optimistic echoes once a refetch newer than the send has landed.
  useLayoutEffect(() => {
    if (pendingUser === null || streaming) return;
    if (dataUpdatedAt > sendStartedAtRef.current) setPendingUser(null);
  }, [dataUpdatedAt, streaming, pendingUser]);

  // Session switch: jump instantly to the latest message once loaded.
  useEffect(() => {
    sessionSwitchRef.current = true;
  }, [activeSessionId]);

  useEffect(() => {
    if (messages.length === 0) return;
    if (sessionSwitchRef.current) {
      sessionSwitchRef.current = false;
      scrollToBottom("instant");
    } else {
      notifyNewContent();
    }
  }, [messages, scrollToBottom, notifyNewContent]);

  // Streaming ticks scroll instantly (pausgård respects a scrolled-up user).
  useEffect(() => {
    if (streaming) notifyNewContent({ streaming: true });
  }, [streaming, streamContent, notifyNewContent]);

  // Own message always re-anchors.
  useEffect(() => {
    if (pendingUser !== null) scrollToBottom("smooth");
  }, [pendingUser, scrollToBottom]);

  // Abort button reveals after 2s of streaming.
  useEffect(() => {
    if (!streaming) {
      setShowAbort(false);
      return;
    }
    const t = window.setTimeout(() => setShowAbort(true), ABORT_REVEAL_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [streaming]);

  // Focus input when a session is opened.
  useEffect(() => {
    if (activeSessionId) inputRef.current?.focus();
  }, [activeSessionId]);

  // --- Handlers -------------------------------------------------------------

  const handleNewSession = useCallback(async () => {
    const session = await createSession.mutateAsync({ title: "Ny konversation" });
    setPendingUser(null);
    setActiveSessionId(session.id);
    setSidebarOpen(false);
  }, [createSession]);

  const selectSession = useCallback((s: ChatSession) => {
    setPendingUser(null);
    setActiveSessionId(s.id);
    setSidebarOpen(false);
  }, []);

  const handleDeleteSession = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      await deleteSession.mutateAsync(id);
      if (activeSessionId === id) setActiveSessionId(null);
    },
    [deleteSession, activeSessionId],
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    let sessionId = activeSessionId;
    if (!sessionId) {
      try {
        const session = await createSession.mutateAsync({ title: text.slice(0, 60) });
        sessionId = session.id;
        setActiveSessionId(sessionId);
      } catch {
        return; // mutation error is surfaced by react-query; keep input intact
      }
    }

    setInput("");
    if (inputRef.current) inputRef.current.style.height = INPUT_BASE_HEIGHT;
    sendStartedAtRef.current = Date.now();
    setPendingUser(text);

    try {
      await send({ message: text, sessionId });
      // Also covers the abort path (send resolves without invalidating).
      qc.invalidateQueries({ queryKey: ["bosse-chat-messages", sessionId] });
      qc.invalidateQueries({ queryKey: ["bosse-chat-sessions"] });
    } catch {
      setPendingUser(null);
      setInput(text);
    }
  }, [input, streaming, activeSessionId, createSession, send, qc]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const applySuggestion = useCallback((text: string) => {
    setInput(text);
    inputRef.current?.focus();
  }, []);

  // --- Render ---------------------------------------------------------------

  return (
    <div className="relative flex h-[calc(100vh-56px-64px)] md:h-screen">
      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Session sidebar */}
      <aside
        aria-label="Konversationslista"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border/30 sidebar-glass transition-transform duration-200 md:relative md:z-0 md:w-64 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/20 px-4">
          <div className="flex items-center gap-2.5">
            <span className="gold-dot" aria-hidden="true" />
            <div className="flex flex-col leading-none">
              <span className="text-sm font-extrabold tracking-tight text-foreground">
                Bosse AI
              </span>
              <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.22em] text-muted-foreground/70">
                Scout Advisor
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground md:hidden"
            aria-label="Stäng konversationslistan"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-3">
          <button
            type="button"
            onClick={handleNewSession}
            disabled={createSession.isPending}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-accent/40 bg-accent/[0.06] px-3 text-sm font-semibold text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
          >
            {createSession.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Ny konversation
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Konversationer">
          {loadingSessions && (
            <div className="space-y-1.5 pt-1" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-11 rounded-sm skeleton-shimmer" />
              ))}
            </div>
          )}

          {GROUP_ORDER.map((label) => {
            const list = groupedSessions[label];
            if (list.length === 0) return null;
            return (
              <div key={label} className="mb-4">
                <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
                  {label}
                </p>
                <div className="space-y-0.5">
                  {list.map((s) => {
                    const active = activeSessionId === s.id;
                    return (
                      <div
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectSession(s)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectSession(s);
                          }
                        }}
                        aria-current={active ? "true" : undefined}
                        className={`group flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left text-[13px] transition-colors ${
                          active
                            ? "nav-active text-foreground"
                            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                        }`}
                      >
                        <MessageCircle
                          className={`h-3.5 w-3.5 shrink-0 ${active ? "text-accent" : ""}`}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {s.title || "Konversation"}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
                          {s.message_count}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteSession(s.id, e)}
                          className="-my-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-muted-foreground/50 opacity-100 transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                          aria-label={`Ta bort konversationen ${s.title || "Konversation"}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {!loadingSessions && sessions.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground/50">
              Inga konversationer ännu
            </p>
          )}
        </nav>
      </aside>

      {/* Main chat column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/30 bg-background/95 px-3 md:px-5">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground md:hidden"
            aria-label="Visa konversationer"
          >
            <History className="h-4 w-4" />
          </button>
          <BosseAvatar size="sm" glow />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-bold tracking-tight text-foreground">
              Bosse Andersson
            </span>
            <span className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
              AI Scout Advisor · 30+ år
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {streaming && <span className="badge-live">Svarar</span>}
            <button
              type="button"
              onClick={handleNewSession}
              disabled={createSession.isPending}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-accent disabled:opacity-50 md:hidden"
              aria-label="Ny konversation"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Messages canvas */}
        <div className="relative min-h-0 flex-1">
          <div
            ref={containerRef}
            className="h-full overflow-y-auto"
            role="log"
            aria-live="polite"
            aria-label="Konversation med Bosse"
          >
            <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:px-6">
              {/* Empty state */}
              {showEmptyState && (
                <div className="flex min-h-[55vh] flex-col items-center justify-center gap-6 text-center">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={SPRING_SNAPPY}
                  >
                    <BosseAvatar size="lg" glow />
                  </motion.div>
                  <div className="space-y-2">
                    <span className="eyebrow">AI Scout Advisor</span>
                    <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
                      Fråga Bosse
                    </h1>
                    <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
                      30+ års scouterfarenhet. Fråga om spelare, taktik, transfermarknaden
                      eller scoutingmetodik — Bosse svarar direkt.
                    </p>
                  </div>
                  <div className="flex max-w-lg flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => applySuggestion(s)}
                        className="min-h-[44px] rounded-md border border-border bg-card px-4 py-2 text-[13px] text-foreground/85 transition-colors hover:border-accent/50 hover:text-foreground"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  {sessions.length > 0 && !activeSessionId && (
                    <p className="text-xs text-muted-foreground/60">
                      Eller fortsätt en tidigare konversation i listan.
                    </p>
                  )}
                </div>
              )}

              {/* Loading skeleton */}
              {loadingMessages && activeSessionId && (
                <div className="space-y-5" aria-hidden="true">
                  <div className="flex gap-3">
                    <div className="h-8 w-8 shrink-0 rounded-full skeleton-shimmer" />
                    <div className="h-16 w-2/3 rounded-md skeleton-shimmer" />
                  </div>
                  <div className="flex justify-end">
                    <div className="h-10 w-1/3 rounded-md skeleton-shimmer" />
                  </div>
                  <div className="flex gap-3">
                    <div className="h-8 w-8 shrink-0 rounded-full skeleton-shimmer" />
                    <div className="h-24 w-3/4 rounded-md skeleton-shimmer" />
                  </div>
                </div>
              )}

              {/* Messages */}
              {messages.map((msg, idx) => (
                <ChatBubble
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  sources={msg.role === "assistant" ? extractSources(msg.metadata) : undefined}
                  animate={idx >= messages.length - ANIMATED_TAIL}
                />
              ))}

              {/* Optimistic user echo */}
              {pendingUser !== null && <ChatBubble role="user" content={pendingUser} animate />}

              {/* Streaming reply */}
              {showStreamEcho && (
                <StreamingBubble content={streamContent} streaming={streaming} />
              )}

              {/* Thinking */}
              {streaming && !streamContent && <ThinkingBubble />}
            </div>
          </div>

          {/* Scroll-to-bottom FAB */}
          <AnimatePresence>
            {!isAnchored && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.6, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.6, y: 8 }}
                transition={SPRING_BOUNCY}
                onClick={() => scrollToBottom("smooth")}
                className="absolute bottom-4 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-accent/40 bg-card text-accent shadow-elevated transition-colors hover:bg-secondary md:right-6"
                aria-label={
                  hasNewBelow ? "Nya meddelanden — scrolla till botten" : "Scrolla till botten"
                }
              >
                <ArrowDown className="h-4 w-4" />
                {hasNewBelow && (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-accent"
                    aria-hidden="true"
                  />
                )}
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Error banner */}
        {error && !streaming && (
          <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
            <div
              role="alert"
              className="mb-2 flex items-start gap-2 rounded-sm border-l-[3px] border-destructive bg-destructive/[0.07] px-4 py-2.5 text-[13px] leading-relaxed text-foreground/90"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span className="min-w-0 break-words line-clamp-2">Något gick fel: {error}</span>
            </div>
          </div>
        )}

        {/* Input */}
        <div
          className="shrink-0 border-t border-border/30 bg-background/95 px-3 pt-3 md:px-6"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
        >
          <div className="mx-auto max-w-3xl">
            <div className="card-editorial flex items-end gap-2 p-2 transition-colors focus-within:border-accent/60">
              <label htmlFor="bosse-chat-input" className="sr-only">
                Meddelande till Bosse
              </label>
              <textarea
                ref={inputRef}
                id="bosse-chat-input"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Fråga Bosse…"
                disabled={streaming}
                rows={1}
                className="max-h-40 min-h-[44px] flex-1 resize-none border-0 bg-transparent px-2.5 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus-visible:shadow-none focus-visible:outline-none disabled:opacity-50"
                style={{ minHeight: INPUT_BASE_HEIGHT }}
              />
              <AnimatePresence>
                {streaming && showAbort && (
                  <motion.button
                    type="button"
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={SPRING_SNAPPY}
                    onClick={abort}
                    className="flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
                    aria-label="Avbryt pågående svar"
                  >
                    <Square className="h-3 w-3 fill-current" />
                    Avbryt
                  </motion.button>
                )}
              </AnimatePresence>
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim() || streaming}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
                aria-label="Skicka meddelande"
              >
                {streaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="mt-1.5 hidden px-1 text-[10px] text-muted-foreground/50 md:block">
              Enter skickar · Skift + Enter för radbrytning
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BosseChat;
