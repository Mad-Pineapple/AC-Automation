import { isClaudeReviewConfigured, reviewAndFix, type FixResult, type ReviewInput } from "./claudeReview";
import { isOpenAIReviewConfigured, reviewAndFixWithOpenAI } from "./openaiArtworkReview";

export type ArtworkGuardProvider = "auto" | "openai" | "claude";

export function isArtworkGuardConfigured(provider: ArtworkGuardProvider = "auto"): boolean {
  if (provider === "openai") return isOpenAIReviewConfigured();
  if (provider === "claude") return isClaudeReviewConfigured();
  return isOpenAIReviewConfigured() || isClaudeReviewConfigured();
}

/** Auto uses OpenAI first, with Claude as a genuine provider fallback. */
export async function runArtworkGuard(input: ReviewInput, provider: ArtworkGuardProvider = "auto", maxReviews = 2): Promise<FixResult> {
  const failures: string[] = [];
  const attempt = async (which: "openai" | "claude") => {
    if (which === "openai") return reviewAndFixWithOpenAI(input, maxReviews);
    return reviewAndFix(input, maxReviews);
  };
  const order: Array<"openai" | "claude"> = provider === "auto" ? ["openai", "claude"] : [provider];
  for (const which of order) {
    if (!isArtworkGuardConfigured(which)) { failures.push(`${which} is not configured`); continue; }
    try {
      const result = await attempt(which);
      result.review.answeredBy = result.review.answeredBy ?? (which === "openai" ? "OpenAI" : "Claude");
      return result;
    } catch (error) {
      failures.push(`${which}: ${error instanceof Error ? error.message : "review failed"}`);
    }
  }
  throw new Error(`AI Artwork Guard could not run, ${failures.join("; ")}`);
}
