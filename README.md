# openclaw-model-failover

OpenClaw plugin to **auto-detect rate limits/quota errors** and switch sessions to fallback LLMs.

## What it does

- Chooses a model based on a **preferred order** before each agent run.
- Detects rate-limit/quota failures and marks the current model as **temporarily limited**.
- Optionally patches pinned WhatsApp group sessions so you don’t get stuck with `API rate limit reached` loops.

## Install (dev)

```bash
cd ~/.openclaw/workspace/openclaw-model-failover
openclaw plugins install -l .
openclaw gateway restart
```

## ClawHub

(Coming) This plugin will be published on clawhub.ai and installable via:

```bash
clawhub install openclaw-model-failover
```

## Configure

In your OpenClaw config:

```json
{
  "plugins": {
    "entries": {
      "openclaw-model-failover": {
        "enabled": true,
        "config": {
          "modelOrder": [
            "anthropic/claude-opus-4-6",
            "openai-codex/gpt-5.2",
            "google-gemini-cli/gemini-2.5-flash"
          ],
          "cooldownMinutes": 300,
          "patchSessionPins": true,
          "notifyOnSwitch": true
        }
      }
    }
  }
}
```

## Notes / Limitations (v0.1)

- This MVP **does not re-run** the exact failed turn automatically.
  It prevents future turns from failing by switching the session model.
- The plugin stores state in `~/.openclaw/workspace/memory/model-ratelimits.json` by default.

## Roadmap

- Auto-retry same turn after switch (requires deeper agent-loop integration)
- Provider-level limits (not only model string keys)
- Per-channel routing policies
