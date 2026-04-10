import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Send, ArrowLeft, Loader2, Plus, Trash2, User, MessageCircle,
  ChevronRight, X, AlertTriangle, Star,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  useChatSessions, useChatMessages, useCreateSession, useDeleteSession, useSendMessage,
} from "@/hooks/use-bosse-chat";
import { formatContent } from "@/lib/format-content";
import { supabase } from "@/integrations/supabase/client";
import type { ChatSession } from "@/types/chat";

// --- Agent types ---
interface ScoutAgent {
  agent_id: string;
  name: string;
  purpose: string | null;
  cluster: string;
  llm_model: string | null;
}

// Bosse gets a special entry in the gallery
const BOSSE_AGENT: ScoutAgent = {
  agent_id: "clone_bosse_andersson",
  name: "Bosse Andersson",
  purpose: "Erfaren fotbollsscout med 30+ \u00e5rs erfarenhet. Fr\u00e5ga om spelare, taktik, transfermarknaden eller scoutingmetodik.",
  cluster: "person_clones",
  llm_model: "claude-opus-4-6",
};

const FEATURED_AGENT_IDS = [
  "clone_bosse_andersson",
  "scout_commander",
  "scout_tactical_analyst",
  "scout_compatibility_engine",
];

// All scout-relevant clusters per playbook (scout-terminal.md)
const SCOUT_CLUSTERS = [
  // Core analysis
  "vault_ai_scout",
  "vault_scout_report",
  "brutal_person_analysis",
  // Sport advisors
  "vault_sport_advisors",
  // Quality pipeline (F0.5–F4.5)
  "kb_alignment_quality",
  "vault_evidence_investigation",
  "vault_improvement_verifier",
  "vault_unified_enforcement",
  // Support (UCF + eval)
  "universal_clone_factory",
  "ucf_eval",
];

// Display order for cluster sections
const CLUSTER_ORDER = [
  "vault_ai_scout",
  "vault_sport_advisors",
  "vault_scout_report",
  "brutal_person_analysis",
  "kb_alignment_quality",
  "vault_evidence_investigation",
  "vault_improvement_verifier",
  "vault_unified_enforcement",
  "universal_clone_factory",
  "ucf_eval",
];

// --- Helpers ---
function getClusterLabel(cluster: string): string {
  switch (cluster) {
    case "vault_ai_scout": return "Scout Core";
    case "vault_scout_report": return "Rapport";
    case "brutal_person_analysis": return "Personanalys";
    case "person_clones": return "Klon";
    case "vault_sport_advisors": return "Sport Advisors";
    case "kb_alignment_quality": return "KB Quality";
    case "vault_evidence_investigation": return "Forensik";
    case "vault_improvement_verifier": return "Verifiering";
    case "vault_unified_enforcement": return "Enforcement";
    case "universal_clone_factory": return "UCF";
    case "ucf_eval": return "UCF Eval";
    default: return cluster;
  }
}

function getClusterDescription(cluster: string): string {
  switch (cluster) {
    case "vault_ai_scout": return "Spelaranalys, taktik och anti-hallucination";
    case "vault_scout_report": return "HTML-rapporter och narrativ";
    case "brutal_person_analysis": return "Djup personlighets- och beteendeanalys";
    case "vault_sport_advisors": return "Expertgranskning av analyser";
    case "kb_alignment_quality": return "Knowledge Base-validering (F0.5)";
    case "vault_evidence_investigation": return "Forensisk utredning (F3.5)";
    case "vault_improvement_verifier": return "Korrekturverifiering (F4.5)";
    case "vault_unified_enforcement": return "Regelefterlevnad (F5)";
    case "universal_clone_factory": return "OSINT, psykologi och nätverksanalys";
    case "ucf_eval": return "Evidenskedjor och konsistenskontroll";
    default: return "";
  }
}

function getModelBadge(model: string | null): string {
  if (!model) return "";
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  if (model.includes("sonar")) return "Sonar";
  return "";
}

function AgentAvatar({ name, size = "md", featured = false }: { name: string; size?: "sm" | "md" | "lg"; featured?: boolean }) {
  const initials = name.split(" ").map((w) => w[0]).join("").substring(0, 2).toUpperCase();
  const sizeClasses = { sm: "w-8 h-8 text-xs", md: "w-11 h-11 text-sm", lg: "w-16 h-16 text-xl" };
  return (
    <div className={`rounded-full flex items-center justify-center font-bold select-none shrink-0 ${sizeClasses[size]} ${
      featured
        ? "bg-gradient-to-br from-accent to-success/70 text-accent-foreground shadow-lg shadow-accent/20"
        : "bg-gradient-to-br from-primary/80 to-primary text-primary-foreground"
    }`}>
      {initials}
    </div>
  );
}

// --- Hook: load scout agents ---
function useScoutAgents() {
  return useQuery<ScoutAgent[]>({
    queryKey: ["scout-agents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("agent_id, name, purpose, cluster, llm_model")
        .in("cluster", SCOUT_CLUSTERS)
        .eq("is_active", true)
        .order("cluster")
        .order("agent_number");
      if (error) throw new Error(error.message);
      return [BOSSE_AGENT, ...(data ?? [])] as ScoutAgent[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

// --- Main component ---
export default function ScoutAgents() {
  const [selectedAgent, setSelectedAgent] = useState<ScoutAgent | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: agents = [], isLoading: loadingAgents } = useScoutAgents();

  const agentId = selectedAgent?.agent_id === "clone_bosse_andersson" ? null : selectedAgent?.agent_id;
  const { data: sessions = [], isLoading: loadingSessions } = useChatSessions(agentId);
  const { data: messages = [], isLoading: loadingMessages } = useChatMessages(activeSessionId);
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();
  const { send, streaming, streamContent, abort, error } = useSendMessage();

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  // Focus input
  useEffect(() => {
    if (selectedAgent) setTimeout(() => inputRef.current?.focus(), 100);
  }, [selectedAgent, activeSessionId]);

  // Reset when agent changes
  useEffect(() => {
    setActiveSessionId(null);
    setInput("");
    setSidebarOpen(false);
  }, [selectedAgent?.agent_id]);

  const handleNewSession = useCallback(async () => {
    if (!selectedAgent) return;
    const session = await createSession.mutateAsync({
      title: "Ny konversation",
      agent_id: selectedAgent.agent_id === "clone_bosse_andersson" ? null : selectedAgent.agent_id,
    });
    setActiveSessionId(session.id);
    setSidebarOpen(false);
  }, [createSession, selectedAgent]);

  const handleDeleteSession = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSession.mutateAsync(id);
    if (activeSessionId === id) setActiveSessionId(null);
  }, [deleteSession, activeSessionId]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming || !selectedAgent) return;

    let sessionId = activeSessionId;
    if (!sessionId) {
      const session = await createSession.mutateAsync({
        title: text.slice(0, 60),
        agent_id: selectedAgent.agent_id === "clone_bosse_andersson" ? null : selectedAgent.agent_id,
      });
      sessionId = session.id;
      setActiveSessionId(sessionId);
    }

    setInput("");
    if (inputRef.current) inputRef.current.style.height = "44px";
    try {
      await send({
        message: text,
        sessionId,
        agentId: selectedAgent.agent_id === "clone_bosse_andersson" ? undefined : selectedAgent.agent_id,
      });
    } catch {
      setInput(text);
    }
  }, [input, streaming, selectedAgent, activeSessionId, createSession, send]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const selectSession = useCallback((s: ChatSession) => {
    setActiveSessionId(s.id);
    setSidebarOpen(false);
  }, []);

  const featured = agents.filter((a) => FEATURED_AGENT_IDS.includes(a.agent_id));
  const others = agents.filter((a) => !FEATURED_AGENT_IDS.includes(a.agent_id));

  // ========== GALLERY VIEW ==========
  if (!selectedAgent) {
    return (
      <div className="p-4 md:p-6 lg:p-8 space-y-8 max-w-6xl mx-auto">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground tracking-tight">Agenter</h1>
          <p className="text-sm text-muted-foreground mt-1">Chatta med Vault AI Scout-agenter. Varje agent har sin specialistroll.</p>
        </div>

        {/* Featured */}
        {featured.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-5 h-5 text-accent" />
              <h2 className="font-display text-lg font-semibold text-foreground">Utvalda</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {featured.map((agent) => (
                <motion.button
                  key={agent.agent_id}
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedAgent(agent)}
                  className="group relative p-5 rounded-2xl border-2 border-accent/30 bg-gradient-to-br from-accent/5 via-card to-success/5 hover:border-accent/60 hover:shadow-lg hover:shadow-accent/10 transition-all text-left"
                >
                  <AgentAvatar name={agent.name} size="lg" featured />
                  <h3 className="font-semibold text-foreground mt-3 text-base">{agent.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">{getClusterLabel(agent.cluster)}</span>
                    {getModelBadge(agent.llm_model) && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{getModelBadge(agent.llm_model)}</span>
                    )}
                  </div>
                  {agent.purpose && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{agent.purpose}</p>}
                  <div className="flex items-center gap-1 mt-3 text-xs text-accent opacity-0 group-hover:opacity-100 transition-opacity">
                    <MessageCircle className="w-3 h-3" />
                    Starta chatt
                    <ChevronRight className="w-3 h-3" />
                  </div>
                </motion.button>
              ))}
            </div>
          </section>
        )}

        {/* All agents grouped by cluster */}
        <section>
          <h2 className="font-display text-lg font-semibold text-foreground mb-2">
            Alla agenter ({agents.length})
          </h2>
          <p className="text-xs text-muted-foreground mb-6">{SCOUT_CLUSTERS.length} kluster &middot; Enhanced pipeline F0–F5</p>

          {CLUSTER_ORDER.map((clusterKey) => {
            const clusterAgents = others.filter((a) => a.cluster === clusterKey);
            if (clusterAgents.length === 0) return null;
            return (
              <div key={clusterKey} className="mb-8">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-accent/10 text-accent uppercase tracking-wider">
                    {getClusterLabel(clusterKey)}
                  </span>
                  <span className="text-xs text-muted-foreground">{clusterAgents.length} agenter</span>
                  <span className="text-xs text-muted-foreground/50 hidden sm:inline">{getClusterDescription(clusterKey)}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {clusterAgents.map((agent) => (
                    <motion.button
                      key={agent.agent_id}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => setSelectedAgent(agent)}
                      className="group flex items-center gap-3 p-4 rounded-xl border border-border/50 bg-card/50 hover:bg-card hover:border-border hover:shadow-md transition-all text-left"
                    >
                      <AgentAvatar name={agent.name} size="md" />
                      <div className="min-w-0 flex-1">
                        <h3 className="font-medium text-foreground text-sm truncate">{agent.name}</h3>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {getModelBadge(agent.llm_model) && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{getModelBadge(agent.llm_model)}</span>
                          )}
                        </div>
                        {agent.purpose && <p className="text-xs text-muted-foreground truncate mt-0.5">{agent.purpose}</p>}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </motion.button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        {loadingAgents && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}
      </div>
    );
  }

  // ========== CHAT VIEW ==========
  const isFeatured = FEATURED_AGENT_IDS.includes(selectedAgent.agent_id);

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
        <div className="p-4 border-b border-border/20">
          <button
            onClick={() => { setSelectedAgent(null); setActiveSessionId(null); }}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-3 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Alla agenter
          </button>
          <div className="flex items-center gap-3">
            <AgentAvatar name={selectedAgent.name} size="md" featured={isFeatured} />
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground text-sm truncate">{selectedAgent.name}</h3>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">{getClusterLabel(selectedAgent.cluster)}</span>
            </div>
          </div>
          <button type="button" onClick={() => setSidebarOpen(false)} className="md:hidden absolute top-4 right-4 p-2 rounded-lg hover:bg-card transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-3">
          <button type="button" onClick={handleNewSession} disabled={createSession.isPending}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl glass-premium border border-accent/30 text-accent text-sm font-medium btn-premium disabled:opacity-50">
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
            <div key={s.id} role="button" tabIndex={0}
              onClick={() => selectSession(s)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSession(s); } }}
              className={`group w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left text-sm transition-all duration-200 cursor-pointer ${
                activeSessionId === s.id ? "nav-active text-accent" : "text-muted-foreground hover:bg-card/50 hover:text-foreground"
              }`}>
              <MessageCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate flex-1">{s.title || "Konversation"}</span>
              <span className="text-[10px] text-muted-foreground/50 shrink-0">{s.message_count}</span>
              <button type="button" onClick={(e) => handleDeleteSession(s.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-all" aria-label="Ta bort">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {!loadingSessions && sessions.length === 0 && (
            <p className="text-xs text-muted-foreground/50 text-center py-6">Ingen historik</p>
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
          <AgentAvatar name={selectedAgent.name} size="sm" featured={isFeatured} />
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-foreground truncate">{selectedAgent.name}</span>
            <span className="text-[10px] text-muted-foreground/60">{getClusterLabel(selectedAgent.cluster)} {getModelBadge(selectedAgent.llm_model) ? `\u00b7 ${getModelBadge(selectedAgent.llm_model)}` : ""}</span>
          </div>
          {streaming && (
            <button type="button" onClick={abort} className="ml-auto text-xs text-muted-foreground hover:text-destructive transition-colors px-2 min-h-[44px] flex items-center">
              Avbryt
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" role="log" aria-live="polite">
          {!activeSessionId && !streaming && sessions.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <AgentAvatar name={selectedAgent.name} size="lg" featured={isFeatured} />
              <div>
                <h2 className="text-lg font-bold text-foreground mb-1">{selectedAgent.name}</h2>
                <p className="text-sm text-muted-foreground max-w-sm">{selectedAgent.purpose || "Redo att chatta."}</p>
              </div>
              <button type="button" onClick={handleNewSession} disabled={createSession.isPending}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-medium btn-premium disabled:opacity-50">
                <Plus className="w-4 h-4" />
                Starta konversation
              </button>
            </div>
          )}

          {!activeSessionId && !streaming && sessions.length > 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <Bot className="w-8 h-8 text-accent/40" />
              <p className="text-sm text-muted-foreground">V\u00e4lj en konversation eller starta en ny</p>
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
                <AgentAvatar name={selectedAgent.name} size="sm" featured={isFeatured} />
              )}
              <div className={`max-w-[80%] md:max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-accent text-accent-foreground rounded-br-md"
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

          {/* Streaming */}
          {streaming && streamContent && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3 justify-start">
              <AgentAvatar name={selectedAgent.name} size="sm" featured={isFeatured} />
              <div className="max-w-[80%] md:max-w-[70%] rounded-2xl rounded-bl-md px-4 py-3 glass-premium text-sm leading-relaxed text-foreground">
                {formatContent(streamContent)}
                <span className="inline-block w-1.5 h-4 bg-accent/60 rounded-sm ml-0.5 animate-pulse" />
              </div>
            </motion.div>
          )}
          {streaming && !streamContent && (
            <div className="flex gap-3 justify-start" role="status" aria-label="Agenten skriver...">
              <AgentAvatar name={selectedAgent.name} size="sm" featured={isFeatured} />
              <div className="glass-premium rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-accent/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-accent/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 bg-accent/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Input */}
        {(activeSessionId || sessions.length === 0) && (
          <div className="border-t border-border/20 p-3 md:p-4 glass shrink-0" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
            <div className="flex items-end gap-2 max-w-3xl mx-auto">
              <label htmlFor="agent-chat-input" className="sr-only">Meddelande</label>
              <textarea ref={inputRef}
                id="agent-chat-input"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  const el = e.target;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 128) + "px";
                }}
                onKeyDown={handleKeyDown}
                placeholder={`Skriv till ${selectedAgent.name}...`}
                disabled={streaming}
                rows={1}
                className="flex-1 resize-none rounded-xl glass-premium px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50 max-h-32"
                style={{ minHeight: "44px" }}
              />
              <button type="button"
                onClick={handleSend}
                disabled={!input.trim() || streaming}
                className="w-11 h-11 rounded-xl bg-accent text-accent-foreground flex items-center justify-center btn-premium disabled:opacity-40 shrink-0"
                aria-label="Skicka meddelande">
                {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
