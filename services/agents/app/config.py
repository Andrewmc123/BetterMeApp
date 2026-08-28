"""Runtime configuration for the BetterMe agent service."""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

# Claude Opus 5 is the default for every agent in this service: the weekly
# review is a reasoning-heavy task where quality matters far more than latency.
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-opus-5")

# Used for the cheap, high-frequency "quick insight" call only.
FAST_MODEL = os.getenv("ANTHROPIC_FAST_MODEL", "claude-sonnet-5")

SHARED_SECRET = os.getenv("AGENTS_SHARED_SECRET", "dev-shared-secret")

# Effort tuning per workload. `high` is the API default; `xhigh` is the sweet
# spot for the long-horizon synthesis the chief strategist does.
EFFORT_SPECIALIST = os.getenv("EFFORT_SPECIALIST", "high")
EFFORT_STRATEGIST = os.getenv("EFFORT_STRATEGIST", "xhigh")
EFFORT_CHAT = os.getenv("EFFORT_CHAT", "high")

MAX_TOKENS_SPECIALIST = 16000
MAX_TOKENS_STRATEGIST = 32000
MAX_TOKENS_CHAT = 32000


def api_key_present() -> bool:
    """The SDK also resolves `ant auth login` profiles, so a missing env var is not fatal."""
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))
