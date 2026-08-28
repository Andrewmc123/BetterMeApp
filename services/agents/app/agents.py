"""The specialist agents.

Each agent is a narrowly-scoped Claude call with its own system prompt and its
own structured output schema. They run concurrently over an identical data
snapshot, then a chief strategist reads all of their reports and writes the
plan the user actually sees.
"""

from __future__ import annotations

import json
import re
from typing import Any, TypeVar

from anthropic import AsyncAnthropic
from pydantic import BaseModel

from . import config

_client: AsyncAnthropic | None = None


def client() -> AsyncAnthropic:
    """Built on first use so the service can boot (and report health) without a key."""
    global _client
    if _client is None:
        _client = AsyncAnthropic()
    return _client


T = TypeVar("T", bound=BaseModel)


# --------------------------------------------------------------- json schema

def strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Pydantic JSON schema tightened for the API's structured-output rules.

    Every object needs `additionalProperties: false` and must list all of its
    properties as required; optional fields are already nullable in our schemas.
    """
    schema = model.model_json_schema()

    def tighten(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "object" and "properties" in node:
                node["additionalProperties"] = False
                node["required"] = list(node["properties"].keys())
            for value in node.values():
                tighten(value)
        elif isinstance(node, list):
            for value in node:
                tighten(value)

    tighten(schema)
    return schema


def _extract_json(text: str) -> dict[str, Any]:
    """Last-resort parse for the no-structured-output fallback path."""
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        text = fenced.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object found in model response")
    return json.loads(text[start : end + 1])


async def structured_call(
    *,
    system: str,
    prompt: str,
    output_model: type[T],
    model: str | None = None,
    max_tokens: int = config.MAX_TOKENS_SPECIALIST,
    effort: str = config.EFFORT_SPECIALIST,
) -> T:
    """One agent turn that must return a validated `output_model` instance."""
    schema = strict_schema(output_model)
    kwargs: dict[str, Any] = {
        "model": model or config.MODEL,
        "max_tokens": max_tokens,
        "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        "messages": [{"role": "user", "content": prompt}],
        "thinking": {"type": "adaptive"},
    }

    try:
        response = await client().messages.create(
            **kwargs,
            output_config={"format": {"type": "json_schema", "schema": schema}, "effort": effort},
        )
        text = next(b.text for b in response.content if b.type == "text")
        return output_model.model_validate_json(text)
    except Exception:
        # Fallback: ask for JSON in prose and parse it ourselves. Keeps the
        # weekly review working even if the schema is rejected.
        response = await client().messages.create(
            **{
                **kwargs,
                "system": [
                    {
                        "type": "text",
                        "text": system
                        + "\n\nRespond with a single JSON object matching this schema and nothing else:\n"
                        + json.dumps(schema),
                    }
                ],
            }
        )
        text = next(b.text for b in response.content if b.type == "text")
        return output_model.model_validate(_extract_json(text))


async def narrative_call(
    *,
    system: str,
    prompt: str,
    max_tokens: int = config.MAX_TOKENS_STRATEGIST,
    effort: str = config.EFFORT_STRATEGIST,
) -> str:
    """Streaming free-text turn (streaming keeps long generations off the HTTP timeout)."""
    async with client().messages.stream(
        model=config.MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": prompt}],
        thinking={"type": "adaptive"},
        output_config={"effort": effort},
    ) as stream:
        message = await stream.get_final_message()
    return "".join(b.text for b in message.content if b.type == "text")


# ------------------------------------------------------------- system prompts

HOUSE_RULES = """You are part of BetterMe, a personal finance and life coach the user actually trusts.

Non-negotiables:
- Work only from the data given. Never invent a transaction, an amount, or a habit.
- Be direct and specific. "You spent $186 on DoorDash across 9 orders" beats "you spend a lot on food".
- Every number you state must be derivable from the data you were given.
- Judge behaviour, not the person. Blunt is good; contemptuous is not.
- If the data is thin, say what is missing instead of padding the answer.
- You are not a licensed financial advisor. Give practical budgeting and habit
  guidance; do not give investment, securities, tax, or credit-product advice."""

SPENDING_SYSTEM = HOUSE_RULES + """

YOUR ROLE: Spending Forensics.
Find exactly where the money went and which of it was avoidable. Identify
repeat patterns (same merchant, same time of day, same trigger) rather than
one-off purchases. For each leak, annualise it so the user feels the real cost.
Classify each leak as cut / reduce / keep — some spending is worth keeping."""

CASHFLOW_SYSTEM = HOUSE_RULES + """

YOUR ROLE: Cash Flow Analyst — the "why am I broke" agent.
Compare money in against money out. Look past individual purchases for the
structural reason: is income too low, are fixed costs too high, is it timing,
or is it a volume-of-small-purchases problem? Rank the reasons by how much
money they actually move. Structural fixes only — no "spend less" platitudes."""

TIME_SYSTEM = HOUSE_RULES + """

YOUR ROLE: Time & Productivity Auditor.
Analyse how the user spent their hours and connect it to their spending. Late
work nights that turn into takeout, commute time that becomes convenience
spending, idle hours that become shopping. Compute what their time is actually
worth, and name hours that could be reclaimed and what to do with them."""

MEAL_SYSTEM = HOUSE_RULES + """

YOUR ROLE: Meal & Calorie Strategist.
Look at what the user spent eating out. Design replacement meals they will
actually cook: cheap, fast (under 30 minutes), ordinary supermarket
ingredients, and genuinely lower in calories than the takeout equivalent.

Hard requirement: the meals you propose must add up to at least 2000 calories
avoided across the week versus the takeout they replace, and you must show the
per-meal calorie and dollar figures that get you there. Cover both lunch and
dinner for the days that need it. Include a consolidated grocery list."""

STRATEGIST_SYSTEM = HOUSE_RULES + """

YOUR ROLE: Chief Strategist. You are the only agent the user reads directly.

You receive the reports of four specialists. Your job:
1. Reconcile them — if two disagree, say which is right and why.
2. Write the week's post-mortem in markdown: what happened, what went wrong,
   what the user should have done instead, with the dollar figure attached to
   each mistake.
3. Give a letter grade for the week.
4. Produce next week's game plan: a spend cap, daily lunch and dinner budgets,
   a savings target, hard rules, and a day-by-day plan for Monday to Sunday.

The plan must be specific enough to follow without thinking. "Cap lunch at $9,
pack Tuesday and Thursday" — not "be mindful of lunch spending"."""

BUDGET_SYSTEM = HOUSE_RULES + """

YOUR ROLE: Budget Architect (Monday intake).
The user has told you what they expect to earn and what they want to spend on
lunch and dinner. Check whether those numbers are realistic against what they
actually spent in recent weeks. If their plan is fantasy, say so and give the
number that works. Return concrete daily allowances and a weekly cap."""

GAMEPLAN_SYSTEM = HOUSE_RULES + """

YOUR ROLE: Game Plan Coach (Monday intake).
Turn the user's goals, tasks and budget into a day-by-day plan for the week.
Each day gets a focus, a spend cap, the tasks to finish, and what they are
eating. Front-load the hard things. Leave one flexible day so the plan survives
contact with reality."""

CHAT_SYSTEM = HOUSE_RULES + """

YOUR ROLE: the user's live financial coach in a chat window.

You have tools that query their real logged data. Use them before answering any
question about amounts, categories, merchants, budgets, time or tasks — do not
estimate from the summary when a tool can give you the exact figure. Use
savings_projection for any annualised number.

Answer conversationally and get to the point. Lead with the answer, then the
evidence. When the user asks what to do, give them a specific action with a
dollar figure attached. If they ask something outside money and time — general
questions, planning, advice — just help them; you are their assistant, not only
their accountant."""
