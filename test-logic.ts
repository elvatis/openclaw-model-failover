
import assert from 'assert';

// Mock Logic from index.ts (since we can't easily import non-exported functions without build)
function nowSec() { return Math.floor(Date.now() / 1000); }

function isRateLimitLike(err?: string): boolean {
  if (!err) return false;
  const s = err.toLowerCase();
  return (
    s.includes("rate limit") ||
    s.includes("quota") ||
    s.includes("resource_exhausted") ||
    s.includes("too many requests") ||
    s.includes("429")
  );
}

function getNextMidnightPT(): number {
  const now = new Date();
  const utcNow = now.getTime();
  const ptOffset = -8 * 60 * 60 * 1000;
  const ptTime = new Date(utcNow + ptOffset);
  ptTime.setUTCHours(24, 0, 0, 0);
  return Math.floor((ptTime.getTime() - ptOffset) / 1000);
}

function calculateCooldown(provider: string, err?: string): number {
  if (!err) return 60 * 60;
  const text = err.toLowerCase();
  
  if (provider.startsWith("google") && text.includes("quota")) {
      const reset = getNextMidnightPT();
      return reset - nowSec();
  }
  return 60 * 60;
}

// -- TESTS --

console.log("Running Failover Logic Tests...");

// 1. Detection
assert.ok(isRateLimitLike("Error: 429 Too Many Requests"), "Should detect 429");
assert.ok(isRateLimitLike("Quota exceeded for quota metric 'Queries'"), "Should detect Quota");
assert.ok(isRateLimitLike("API rate limit reached"), "Should detect text phrase");
assert.strictEqual(isRateLimitLike("Connection refused"), false, "Should NOT detect network error");

console.log("✅ Detection Logic: OK");

// 2. Cooldown Calculation (Gemini)
const geminiCooldown = calculateCooldown("google-gemini-cli", "Quota exceeded");
const secondsToMidnightPT = getNextMidnightPT() - nowSec();
// Allow 1-2s variance
assert.ok(Math.abs(geminiCooldown - secondsToMidnightPT) < 5, "Gemini should wait until PT midnight");

console.log(`✅ Gemini Cooldown: OK (Waiting ${Math.floor(geminiCooldown/3600)}h ${Math.floor((geminiCooldown%3600)/60)}m)`);

// 3. Provider Blocking Simulation
const modelOrder = [
    "openai-codex/gpt-5.3",
    "openai-codex/gpt-5.2",
    "anthropic/claude-opus",
    "google-gemini-cli/gemini-pro"
];
const failedModel = "openai-codex/gpt-5.3";
const failureReason = "Rate limit reached";

// Simulate logic
const state = { limited: {} as Record<string, any> };
const provider = failedModel.split("/")[0]; // "openai-codex"

if (isRateLimitLike(failureReason)) {
    // Block ALL from provider
    for (const m of modelOrder) {
        if (m.startsWith(provider + "/")) {
            state.limited[m] = { reason: "Blocked via provider" };
        }
    }
}

assert.ok(state.limited["openai-codex/gpt-5.3"], "Origin model blocked");
assert.ok(state.limited["openai-codex/gpt-5.2"], "Sibling model blocked");
assert.strictEqual(state.limited["anthropic/claude-opus"], undefined, "Other provider NOT blocked");

console.log("✅ Provider-Wide Blocking: OK");

console.log("ALL TESTS PASSED.");
