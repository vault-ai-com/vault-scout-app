import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageCircle, Plus, Send, Trash2, Loader2, ArrowLeft, User, Bot, X, AlertTriangle,
} from "lucide-react";
import {
  useChatSessions, useChatMessages, useCreateSession, useDeleteSession, useSendMessage,
} from "@/hooks/use-bosse-chat";
import type { ChatSession } from "@/types/chat";

// --- Markdown-lite: bold + line breaks ---
function formatContent(text: string) {
  return text.split("\n").map((line, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {line.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
        part.startsWith("**") && part.endsWith("**")
          ? <strong key={j} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
          : part
      )}
    </span>
  ));
}

const BosseChat = () => {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: sessions = [], isLoading: loadingSessions } = useChatSessions();
  const { data: messages = [], isLoading: loadingMessages } = useChatMessages(activeSessionId);
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();
  const { send, streaming, streamContent, abort, error } = useSendMessage();

  // Auto-scroll on new messages or streaming
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  // Focus input when session changes
  useEffect(() => {
    if (activeSessionId) inputRef.current?.focus();
  }, [activeSessionId]);

  const handleNewSession = useCallback(async () => {
    const session = await createSession.mutateAsync({ title: "Ny konversation" });
    setActiveSessionId(session.id);
    setSidebarOpen(false);
  }, [createSession]);

  const handleDeleteSession = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSession.mutateAsync(id);
    if (activeSessionId === id) setActiveSessionId(null);
  }, [deleteSession, activeSessionId]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    let sessionId = activeSessionId;

    // Auto-create session if none active
    if (!sessionId) {
      const session = await createSession.mutateAsync({
        title: text.slice(0, 60),
      });
      sessionId = session.id;
      setActiveSessionId(sessionId);
    }

    setInput("");
    if (inputRef.current) inputRef.current.style.height = "44px";
    try {
      await send({ message: text, sessionId });
    } catch {
      setInput(text);
    }
  }, [input, streaming, activeSessionId, createSession, send]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const selectSession = useCallback((s: ChatSession) => {
    setActiveSessionId(s.id);
    setSidebarOpen(false);
  }, []);

  return (
    <div className="flex h-[calc(100vh-56px-64px)] md:h-screen relative">
      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Session sidebar */}
      <aside className={`
        fixed md:relative inset-y-0 left-0 z-50 md:z-0
        w-72 md:w-64 flex flex-col border-r border-border/30 sidebar-glass
        transition-transform duration-200
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}>
        <div className="flex items-center justify-between px-4 h-14 border-b border-border/20">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl icon-premium flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm font-bold text-foreground">Bosse AI</span>
          </div>
          <button type="button" onClick={() => setSidebarOpen(false)} className="md:hidden p-2.5 rounded-lg hover:bg-card transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-3">
          <button type="button" onClick={handleNewSession}
            disabled={createSession.isPending}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl glass-premium border border-primary/30 text-primary text-sm font-medium btn-premium disabled:opacity-50">
            <Plus className="w-4 h-4" />
            Ny konversation
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 space-y-1">
          {loadingSessions && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {sessions.map((s) => (
            <div key={s.id}
              role="button" tabIndex={0}
              onClick={() => selectSession(s)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSession(s); } }}
              className={`group w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left text-sm transition-all duration-200 cursor-pointer ${
                activeSessionId === s.id
                  ? "nav-active text-primary"
                  : "text-muted-foreground hover:bg-card/50 hover:text-foreground"
              }`}>
              <MessageCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate flex-1">{s.title || "Konversation"}</span>
              <span className="text-[10px] text-muted-foreground/50 shrink-0">{s.message_count}</span>
              <button type="button"
                onClick={(e) => handleDeleteSession(s.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-all"
                aria-label="Ta bort konversation">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {!loadingSessions && sessions.length === 0 && (
            <p className="text-xs text-muted-foreground/50 text-center py-6">Inga konversationer ännu</p>
          )}
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-border/20 glass shrink-0">
          <button type="button" onClick={() => setSidebarOpen(true)} className="md:hidden p-2.5 rounded-lg hover:bg-card transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-accent/70 flex items-center justify-center shadow-md">
            <Bot className="w-4 h-4 text-background" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-foreground truncate">Bosse Andersson</span>
            <span className="text-[10px] text-muted-foreground/60">AI Scout Advisor</span>
          </div>
          {streaming && (
            <button type="button" onClick={abort} className="ml-auto text-xs text-muted-foreground hover:text-destructive transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center px-2">
              Avbryt
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" role="log" aria-live="polite">
          {!activeSessionId && !streaming && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent/20 to-primary/10 flex items-center justify-center">
                <Bot className="w-8 h-8 text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground mb-1">Prata med Bosse</h2>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Din AI-scoutingadvisor med 30+ års erfarenhet. Fråga om spelare, taktik, transfermarknaden eller scoutingmetodik.
                </p>
              </div>
              <button type="button" onClick={handleNewSession}
                disabled={createSession.isPending}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium btn-premium disabled:opacity-50">
                <Plus className="w-4 h-4" />
                Starta konversation
              </button>
            </div>
          )}

          {loadingMessages && activeSessionId && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {messages.map((msg) => (
            <motion.div key={msg.id}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
              className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent/70 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-background" />
                </div>
              )}
              <div className={`max-w-[80%] md:max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "glass-premium rounded-bl-md text-foreground"
              }`}>
                {formatContent(msg.content)}
              </div>
              {msg.role === "user" && (
                <div className="w-7 h-7 rounded-full bg-card border border-border/30 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              )}
            </motion.div>
          ))}

          {/* Streaming indicator */}
          {streaming && streamContent && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className="flex gap-3 justify-start">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent/70 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-background" />
              </div>
              <div className="max-w-[80%] md:max-w-[70%] rounded-2xl rounded-bl-md px-4 py-3 glass-premium text-sm leading-relaxed text-foreground">
                {formatContent(streamContent)}
                <span className="inline-block w-1.5 h-4 bg-primary/60 rounded-sm ml-0.5 animate-pulse" />
              </div>
            </motion.div>
          )}

          {streaming && !streamContent && (
            <div className="flex gap-3 justify-start" role="status" aria-live="polite" aria-label="Bosse skriver...">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent/70 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-background" />
              </div>
              <div className="glass-premium rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Input area */}
        {(activeSessionId || sessions.length === 0) && (
          <div className="border-t border-border/20 p-3 md:p-4 glass shrink-0" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
            <div className="flex items-end gap-2 max-w-3xl mx-auto">
              <label htmlFor="bosse-chat-input" className="sr-only">Meddelande</label>
              <textarea ref={inputRef}
                id="bosse-chat-input"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  const el = e.target;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 128) + "px";
                }}
                onKeyDown={handleKeyDown}
                placeholder="Skriv ett meddelande..."
                disabled={streaming}
                rows={1}
                className="flex-1 resize-none rounded-xl glass-premium px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50 max-h-32"
                style={{ minHeight: "44px" }}
              />
              <button type="button"
                onClick={handleSend}
                disabled={!input.trim() || streaming}
                className="w-11 h-11 rounded-xl bg-primary text-primary-foreground flex items-center justify-center btn-premium disabled:opacity-40 shrink-0"
                aria-label="Skicka meddelande">
                {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BosseChat;
