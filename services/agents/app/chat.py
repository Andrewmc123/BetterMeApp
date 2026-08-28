"""Real-time streaming chat agent with tool use.

A manual agentic loop rather than the SDK tool runner: the browser needs tokens
as they are produced *and* visibility into which tool is running, which means
owning the stream events directly.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from . import agents, config
from .tools import TOOL_DEFINITIONS, execute_tool

MAX_TOOL_ROUNDS = 8


def sse(payload: dict[str, Any], event: str | None = None) -> str:
    prefix = f"event: {event}\n" if event else ""
    return f"{prefix}data: {json.dumps(payload)}\n\n"


def _context_block(snapshot: dict[str, Any]) -> str:
    """Compact orientation summary. Detail comes from the tools, not from here."""
    return json.dumps(
        {
            "user": snapshot.get("user"),
            "period": snapshot.get("period"),
            "totals": snapshot.get("totals"),
            "plan": snapshot.get("plan"),
            "accounts": snapshot.get("accounts"),
            "prior_weeks": snapshot.get("priorWeeks"),
            "transaction_count": len(snapshot.get("expenses", [])),
        },
        indent=2,
        default=str,
    )


async def stream_chat(
    snapshot: dict[str, Any], history: list[dict[str, str]]
) -> AsyncIterator[str]:
    system = [
        {"type": "text", "text": agents.CHAT_SYSTEM, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": f"CURRENT DATA SUMMARY:\n{_context_block(snapshot)}"},
    ]

    messages: list[dict[str, Any]] = [
        {"role": m["role"], "content": m["content"]}
        for m in history
        if m.get("content", "").strip()
    ]
    if not messages:
        yield sse({"message": "No message to answer"}, event="error")
        return

    try:
        for _round in range(MAX_TOOL_ROUNDS):
            async with agents.client().messages.stream(
                model=config.MODEL,
                max_tokens=config.MAX_TOKENS_CHAT,
                system=system,
                messages=messages,
                tools=TOOL_DEFINITIONS,
                thinking={"type": "adaptive", "display": "summarized"},
                output_config={"effort": config.EFFORT_CHAT},
            ) as stream:
                async for event in stream:
                    if event.type == "content_block_delta":
                        if event.delta.type == "text_delta":
                            yield sse({"type": "text", "text": event.delta.text})
                        elif event.delta.type == "thinking_delta":
                            yield sse({"type": "thinking", "text": event.delta.thinking})
                    elif event.type == "content_block_start" and event.content_block.type == "tool_use":
                        yield sse({"type": "tool_start", "name": event.content_block.name})

                message = await stream.get_final_message()

            if message.stop_reason == "refusal":
                yield sse(
                    {
                        "message": "I can't help with that one. Ask me something else about your money or your week."
                    },
                    event="error",
                )
                return

            tool_uses = [b for b in message.content if b.type == "tool_use"]
            if not tool_uses:
                break

            # Echo the full content back (thinking blocks included) so the model
            # keeps its reasoning across the tool round-trip.
            messages.append({"role": "assistant", "content": message.content})

            results = []
            for block in tool_uses:
                output = execute_tool(block.name, dict(block.input or {}), snapshot)
                yield sse({"type": "tool_result", "name": block.name, "ok": "error" not in output})
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(output, default=str),
                        **({"is_error": True} if "error" in output else {}),
                    }
                )
            # All results for a turn go back in a single user message.
            messages.append({"role": "user", "content": results})
        else:
            yield sse({"type": "text", "text": "\n\n_(Stopped after too many tool steps.)_"})

        yield sse({"type": "done"})
    except Exception as exc:
        yield sse({"message": f"{type(exc).__name__}: {exc}"}, event="error")
