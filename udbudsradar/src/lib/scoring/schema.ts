import { z } from "zod";

/**
 * The shape SPEC §5 asks for. Validated with zod on the way in, so a
 * hallucinated field or an out-of-range score never reaches the database.
 */
export const noticeVerdictSchema = z.object({
  /** Index into the batch we sent, so verdicts cannot be silently mismatched. */
  nr: z.number().int().nonnegative(),
  score: z.number().int().min(0).max(100),
  reasoning: z.string().min(1).max(600),
  fit: z.enum(["stærk", "mulig", "svag"]),
  concerns: z.array(z.string().max(200)).max(5),
});

export const scoringResponseSchema = z.object({
  vurderinger: z.array(noticeVerdictSchema).min(1),
});

export type NoticeVerdict = z.infer<typeof noticeVerdictSchema>;
export type ScoringResponse = z.infer<typeof scoringResponseSchema>;
