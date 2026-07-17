import { BosseAvatar } from "./ChatAvatar";
import { ChatMarkdown } from "./ChatMarkdown";
import { ASSISTANT_BUBBLE, BUBBLE_MAX_WIDTH, MICRO_LABEL } from "./ChatBubbleStyles";

/**
 * Live-rendered assistant reply during streaming: accumulated content as
 * markdown + blinking gold caret. If the stream looks like raw JSON /
 * a code fence, shimmer bars render instead of dumping structure at the user.
 */

function looksLikeRawStructure(content: string): boolean {
  const t = content.trimStart();
  return t.startsWith("{") || t.startsWith("[") || t.startsWith("```");
}

interface StreamingBubbleProps {
  content: string;
  /** True while the stream is still open — controls the caret. */
  streaming: boolean;
}

export function StreamingBubble({ content, streaming }: StreamingBubbleProps) {
  const raw = looksLikeRawStructure(content);

  return (
    <div className="flex justify-start gap-3">
      <BosseAvatar size="sm" />
      <div className={`min-w-0 ${BUBBLE_MAX_WIDTH} ${ASSISTANT_BUBBLE}`}>
        {raw ? (
          <>
            <p className={`${MICRO_LABEL} text-accent`}>Bosse strukturerar svaret…</p>
            <div className="mt-2.5 space-y-2" aria-hidden="true">
              <div className="h-3 w-56 max-w-full rounded-sm skeleton-shimmer" />
              <div className="h-3 w-40 max-w-full rounded-sm skeleton-shimmer" />
              <div className="h-3 w-48 max-w-full rounded-sm skeleton-shimmer" />
            </div>
          </>
        ) : (
          <>
            <span className="sr-only">Bosse: </span>
            <ChatMarkdown
              content={content}
              trailing={
                streaming ? (
                  <span
                    className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-primary/60"
                    aria-hidden="true"
                  />
                ) : undefined
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
