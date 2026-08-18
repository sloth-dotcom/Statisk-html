import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Notice, Profile } from "@/db/schema";
import { env, requireEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { buildScoringMessage, SCORING_SYSTEM_PROMPT } from "./prompt";
import { scoringResponseSchema, type NoticeVerdict } from "./schema";

export interface ScoringOutcome {
  verdicts: NoticeVerdict[];
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/** Injectable so tests can score without an API key or a network call. */
export interface ScoringModel {
  readonly name: string;
  score(profile: Profile, batch: Notice[]): Promise<ScoringOutcome>;
}

export class AnthropicScoringModel implements ScoringModel {
  private readonly client: Anthropic;
  readonly name: string;

  constructor(client?: Anthropic, model?: string) {
    this.client = client ?? new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
    this.name = model ?? env().ANTHROPIC_MODEL;
  }

  async score(profile: Profile, batch: Notice[]): Promise<ScoringOutcome> {
    const response = await this.client.messages.parse({
      model: this.name,
      max_tokens: 16000,
      system: SCORING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildScoringMessage(profile, batch) }],
      output_config: {
        format: zodOutputFormat(scoringResponseSchema),
        effort: env().ANTHROPIC_EFFORT,
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error("Claude returnerede et svar der ikke matchede skemaet for scoring.");
    }

    log.info("scoring.batch_done", {
      model: this.name,
      notices: batch.length,
      verdicts: parsed.vurderinger.length,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    return {
      verdicts: parsed.vurderinger,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: this.name,
    };
  }
}
