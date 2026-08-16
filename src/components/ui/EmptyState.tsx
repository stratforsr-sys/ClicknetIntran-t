import type { ReactNode } from "react";

/**
 * UI-PRD §5.7 och §8: rubrik, en mening som forklarar vad som saknas,
 * och en handling. Tomma tillstand utan handling godkanns inte i §11.
 */
export function EmptyState({
  rubrik,
  text,
  handling,
}: {
  rubrik: string;
  text: string;
  handling?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border-2 border-dashed border-ink-300/50 px-6 py-12 text-center">
      <h3 className="text-h2 text-ink-900">{rubrik}</h3>
      <p className="max-w-[46ch] text-body text-ink-500">{text}</p>
      {handling && <div className="mt-2">{handling}</div>}
    </div>
  );
}
