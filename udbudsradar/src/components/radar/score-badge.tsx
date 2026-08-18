import { Badge } from "@/components/ui/badge";

/** Colour follows the score, not the other way round: 75+ green, 50+ yellow. */
export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return <Badge tone="neutral" title="Ikke scoret endnu">Ikke scoret</Badge>;
  }
  const tone = score >= 75 ? "groen" : score >= 50 ? "gul" : "roed";
  return (
    <Badge tone={tone} title="AI-score 0-100">
      {score}
    </Badge>
  );
}
