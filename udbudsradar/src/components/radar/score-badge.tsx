import { cn } from "@/lib/utils";

/**
 * The score is the first thing to read on a card, so it is a number and not a
 * label. Colour follows the score: 75+ green, 50+ yellow, below that red.
 */
export function ScoreBadge({ score, className }: { score: number | null; className?: string }) {
  if (score === null) {
    return (
      <span
        title="Ikke scoret endnu"
        className={cn(
          "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-[var(--color-kant)] bg-[var(--color-flade)] px-2 text-xs font-medium text-[var(--color-daempet)]",
          className,
        )}
      >
        ikke scoret
      </span>
    );
  }

  const tone =
    score >= 75
      ? "border-[var(--color-groen)] bg-[var(--color-groen-svag)] text-[var(--color-groen)]"
      : score >= 50
        ? "border-[var(--color-gul)] bg-[var(--color-gul-svag)] text-[var(--color-gul)]"
        : "border-[var(--color-roed)] bg-[var(--color-roed-svag)] text-[var(--color-roed)]";

  return (
    <span
      title="AI-score 0-100"
      className={cn("inline-flex h-8 min-w-10 items-center justify-center rounded-md border px-2 text-base font-semibold tabular-nums", tone, className)}
    >
      {score}
    </span>
  );
}
