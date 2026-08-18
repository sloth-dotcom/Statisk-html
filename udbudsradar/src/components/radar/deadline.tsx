import { Badge } from "@/components/ui/badge";
import { daysUntil, formatDateCopenhagen } from "@/lib/time";

/**
 * Deadlines are legally binding (SPEC §8), so the days-left number is the loud
 * part and the date is next to it — red under seven days.
 */
export function DeadlineBadge({ deadline }: { deadline: Date | string | null }) {
  const days = daysUntil(deadline);
  if (days === null) return <Badge tone="neutral">Frist ikke oplyst</Badge>;

  const label =
    days < 0 ? "Fristen er overskredet" : days === 0 ? "Frist i dag" : days === 1 ? "1 dag tilbage" : `${days} dage tilbage`;
  const tone = days < 0 ? "neutral" : days < 7 ? "roed" : days < 21 ? "gul" : "groen";

  return (
    <Badge tone={tone} title={`Tilbudsfrist ${formatDateCopenhagen(deadline)}`}>
      {label} · {formatDateCopenhagen(deadline)}
    </Badge>
  );
}
