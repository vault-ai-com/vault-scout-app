import { Fragment, useMemo } from "react";
import type { ReactNode } from "react";

/**
 * Markdown-lite renderer for chat content — editorial, dependency-free.
 * Supports: #/##/### headings, unordered (- * •) and ordered (1. / 1))
 * lists, paragraphs with soft line breaks, **bold** and `inline code`.
 * Everything else renders as plain text (never dangerouslySetInnerHTML).
 */

type Block =
  | { kind: "heading"; level: number; text: string; key: number }
  | { kind: "list"; ordered: boolean; items: string[]; key: number }
  | { kind: "paragraph"; lines: string[]; key: number };

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const UL_RE = /^[-*•]\s+/;
const OL_RE = /^\d+[.)]\s+/;
const INLINE_SPLIT_RE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(INLINE_SPLIT_RE)
    .filter((part) => part !== "")
    .map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length >= 5) {
        return (
          <strong key={`${keyPrefix}-${i}`} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith("`") && part.endsWith("`") && part.length >= 3) {
        return (
          <code
            key={`${keyPrefix}-${i}`}
            className="rounded-sm bg-secondary px-1 py-0.5 font-mono text-[0.85em] text-foreground/90"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>;
    });
}

function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let key = 0;
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2], key: key++ });
      i++;
      continue;
    }

    if (UL_RE.test(trimmed) || OL_RE.test(trimmed)) {
      const ordered = OL_RE.test(trimmed);
      const marker = ordered ? OL_RE : UL_RE;
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!marker.test(t)) break;
        items.push(t.replace(marker, ""));
        i++;
      }
      blocks.push({ kind: "list", ordered, items, key: key++ });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === "" || HEADING_RE.test(t) || UL_RE.test(t) || OL_RE.test(t)) break;
      para.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "paragraph", lines: para, key: key++ });
  }

  return blocks;
}

function renderBlock(block: Block, trailing: ReactNode | undefined): ReactNode {
  switch (block.kind) {
    case "heading": {
      const cls =
        block.level >= 3
          ? "text-[13px] font-semibold"
          : "text-[13.5px] font-bold";
      return (
        <p key={block.key} className={`${cls} tracking-tight text-foreground`}>
          {renderInline(block.text, `h${block.key}`)}
          {trailing}
        </p>
      );
    }
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i}>
          {renderInline(item, `l${block.key}-${i}`)}
          {i === block.items.length - 1 ? trailing : null}
        </li>
      ));
      return block.ordered ? (
        <ol
          key={block.key}
          className="list-decimal space-y-1 pl-5 marker:font-semibold marker:text-accent"
        >
          {items}
        </ol>
      ) : (
        <ul key={block.key} className="list-disc space-y-1 pl-5 marker:text-accent">
          {items}
        </ul>
      );
    }
    case "paragraph":
      return (
        <p key={block.key}>
          {block.lines.map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {renderInline(line, `p${block.key}-${j}`)}
            </Fragment>
          ))}
          {trailing}
        </p>
      );
  }
}

interface ChatMarkdownProps {
  content: string;
  /** Node appended inline at the very end (e.g. a streaming caret). */
  trailing?: ReactNode;
}

export function ChatMarkdown({ content, trailing }: ChatMarkdownProps) {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  if (blocks.length === 0) {
    return trailing ? <div className="text-sm leading-relaxed">{trailing}</div> : null;
  }

  return (
    <div className="space-y-2.5 text-sm leading-relaxed">
      {blocks.map((block, idx) =>
        renderBlock(block, idx === blocks.length - 1 ? trailing : undefined),
      )}
    </div>
  );
}
