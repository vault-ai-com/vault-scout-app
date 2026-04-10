// Shared markdown-lite renderer: bold (**text**) + line breaks
export function formatContent(text: string) {
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
