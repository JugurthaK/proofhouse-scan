function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("Index:") || line.startsWith("===="))
    return "text-ink-3 font-medium";
  if (line.startsWith("+")) return "bg-good-bg text-good";
  if (line.startsWith("-")) return "bg-bad-bg text-bad";
  if (line.startsWith("@@")) return "bg-brand-50 text-brand-700";
  return "text-ink-2";
}

export function PatchViewer({ diff }: { diff: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-line bg-surface-1 py-2 text-xs leading-5">
      <code className="block min-w-max">
        {diff.split("\n").map((line, i) => (
          <span key={i} className={`block px-4 ${lineClass(line)}`}>
            {line || " "}
          </span>
        ))}
      </code>
    </pre>
  );
}
