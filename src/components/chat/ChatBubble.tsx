import { motion } from "framer-motion";
import { SPRING_SNAPPY } from "@/lib/motion";
import { BosseAvatar } from "./ChatAvatar";
import { ChatMarkdown } from "./ChatMarkdown";
import { ASSISTANT_BUBBLE, BUBBLE_MAX_WIDTH, USER_BUBBLE } from "./ChatBubbleStyles";

interface ChatBubbleProps {
  role: "user" | "assistant";
  content: string;
  /** Source references rendered as gold micro-pills under the bubble. */
  sources?: string[];
  /** Only the last ~3 messages get a motion wrapper (perf). */
  animate?: boolean;
}

export function ChatBubble({ role, content, sources = [], animate = false }: ChatBubbleProps) {
  const inner =
    role === "user" ? (
      <div className="flex justify-end">
        <div className={`${BUBBLE_MAX_WIDTH} ${USER_BUBBLE}`}>
          <span className="sr-only">Du: </span>
          <ChatMarkdown content={content} />
        </div>
      </div>
    ) : (
      <div className="flex justify-start gap-3">
        <BosseAvatar size="sm" />
        <div className={`min-w-0 ${BUBBLE_MAX_WIDTH}`}>
          <div className={ASSISTANT_BUBBLE}>
            <span className="sr-only">Bosse: </span>
            <ChatMarkdown content={content} />
          </div>
          {sources.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Källor">
              {sources.map((source) => (
                <span key={source} className="pill-gold max-w-[240px] truncate normal-case tracking-normal">
                  {source}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );

  if (!animate) return inner;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_SNAPPY}>
      {inner}
    </motion.div>
  );
}
