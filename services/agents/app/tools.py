"""Client-side tools the chat agent can call against the user's own data.

These are plain deterministic Python functions over the snapshot the Node API
sends with each request. Keeping the maths here (rather than asking the model to
do arithmetic in its head) is what makes the coach's numbers trustworthy.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

Snapshot = dict[str, Any]


# ------------------------------------------------------------ implementations

def spending_by_category(snapshot: Snapshot, necessity: str | None = None) -> dict[str, Any]:
    totals: dict[str, float] = defaultdict(float)
    counts: dict[str, int] = defaultdict(int)
    for e in snapshot.get("expenses", []):
        if necessity and necessity != "any" and e.get("necessity") != necessity:
            continue
        totals[e["category"]] += float(e["amount"])
        counts[e["category"]] += 1
    ranked = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    return {
        "period": snapshot.get("period", {}).get("label"),
        "total": round(sum(totals.values()), 2),
        "categories": [
            {"category": c, "amount": round(a, 2), "transactions": counts[c]} for c, a in ranked
        ],
    }


def list_transactions(
    snapshot: Snapshot,
    category: str | None = None,
    min_amount: float = 0.0,
    limit: int = 25,
) -> dict[str, Any]:
    rows = [
        e
        for e in snapshot.get("expenses", [])
        if (not category or category == "any" or e["category"] == category)
        and float(e["amount"]) >= min_amount
    ]
    rows.sort(key=lambda e: float(e["amount"]), reverse=True)
    return {"count": len(rows), "transactions": rows[:limit]}


def merchant_frequency(snapshot: Snapshot, limit: int = 10) -> dict[str, Any]:
    totals: dict[str, float] = defaultdict(float)
    counts: dict[str, int] = defaultdict(int)
    for e in snapshot.get("expenses", []):
        name = (e.get("merchant") or e.get("description") or "unknown").strip().lower()
        totals[name] += float(e["amount"])
        counts[name] += 1
    ranked = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    return {
        "merchants": [
            {"merchant": m, "total": round(t, 2), "visits": counts[m], "avg": round(t / counts[m], 2)}
            for m, t in ranked
        ]
    }


def time_breakdown(snapshot: Snapshot) -> dict[str, Any]:
    totals = snapshot.get("totals", {})
    minutes = totals.get("activityMinutesByCategory", {}) or {}
    return {
        "work_hours": totals.get("workHours", 0),
        "earned": totals.get("earned", 0),
        "effective_hourly_rate": totals.get("effectiveHourlyRate"),
        "hours_by_category": {k: round(v / 60, 2) for k, v in minutes.items()},
        "logged_hours_total": round(sum(minutes.values()) / 60, 2),
    }


def budget_status(snapshot: Snapshot) -> dict[str, Any]:
    plan = snapshot.get("plan")
    # Derived from the transactions rather than the summary, so this tool can
    # never disagree with spending_by_category.
    spent = round(sum(float(e["amount"]) for e in snapshot.get("expenses", [])), 2)
    if not plan:
        return {"has_plan": False, "spent": spent, "message": "No weekly budget set yet."}
    cap = (float(plan.get("lunchBudget", 0)) + float(plan.get("dinnerBudget", 0))) * 7 + float(
        plan.get("otherBudget", 0)
    )
    return {
        "has_plan": True,
        "weekly_cap": round(cap, 2),
        "spent": spent,
        "remaining": round(cap - spent, 2),
        "over_by": round(max(0.0, spent - cap), 2),
        "daily_lunch_budget": plan.get("lunchBudget"),
        "daily_dinner_budget": plan.get("dinnerBudget"),
    }


def savings_projection(cuts: dict[str, float]) -> dict[str, Any]:
    """`cuts` maps a category to the weekly dollars removed from it."""
    weekly = round(sum(float(v) for v in cuts.values()), 2)
    return {
        "weekly_savings": weekly,
        "monthly_savings": round(weekly * 4.33, 2),
        "annual_savings": round(weekly * 52, 2),
        "breakdown": {k: round(float(v), 2) for k, v in cuts.items()},
    }


def meal_savings(
    eat_out_price: float, cook_price: float, meals_per_week: int, calories_out: int, calories_cooked: int
) -> dict[str, Any]:
    per_meal = max(0.0, eat_out_price - cook_price)
    cal_per_meal = max(0, calories_out - calories_cooked)
    return {
        "dollars_saved_per_week": round(per_meal * meals_per_week, 2),
        "dollars_saved_per_year": round(per_meal * meals_per_week * 52, 2),
        "calories_saved_per_week": cal_per_meal * meals_per_week,
        "meals_per_week": meals_per_week,
    }


def task_status(snapshot: Snapshot) -> dict[str, Any]:
    tasks = snapshot.get("tasks", [])
    return {
        "open": [t for t in tasks if t["status"] == "open"][:25],
        "completed_count": sum(1 for t in tasks if t["status"] == "done"),
        "open_count": sum(1 for t in tasks if t["status"] == "open"),
    }


# ------------------------------------------------------------ tool definitions

TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "spending_by_category",
        "description": "Total the user's spending for the current week, grouped by category and ranked highest first. Use this before making any claim about where their money went.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "necessity": {
                    "type": "string",
                    "enum": ["any", "need", "want", "unknown"],
                    "description": "Filter to needs or wants only. Use 'any' for everything.",
                }
            },
            "required": ["necessity"],
            "additionalProperties": False,
        },
    },
    {
        "name": "list_transactions",
        "description": "List individual transactions, largest first, optionally filtered by category and minimum amount.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {"type": "string", "description": "Category to filter by, or 'any'."},
                "min_amount": {"type": "number", "description": "Only include transactions at or above this amount."},
                "limit": {"type": "integer", "description": "Maximum number of transactions to return."},
            },
            "required": ["category", "min_amount", "limit"],
            "additionalProperties": False,
        },
    },
    {
        "name": "merchant_frequency",
        "description": "Rank merchants by total spend, showing visit count and average ticket. Use this to find repeat-offender habits.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "description": "How many merchants to return."}},
            "required": ["limit"],
            "additionalProperties": False,
        },
    },
    {
        "name": "time_breakdown",
        "description": "Get work hours, money earned, effective hourly rate, and hours logged per activity category for the week.",
        "strict": True,
        "input_schema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    },
    {
        "name": "budget_status",
        "description": "Compare spending so far against the weekly budget the user committed to on Monday.",
        "strict": True,
        "input_schema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    },
    {
        "name": "savings_projection",
        "description": "Project weekly, monthly and annual savings from cutting specific categories. Always use this instead of estimating annualised numbers yourself.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "cuts": {
                    "type": "array",
                    "description": "The weekly dollar reduction proposed for each category.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "category": {"type": "string"},
                            "weekly_amount": {"type": "number"},
                        },
                        "required": ["category", "weekly_amount"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["cuts"],
            "additionalProperties": False,
        },
    },
    {
        "name": "meal_savings",
        "description": "Compute dollars and calories saved by cooking a meal instead of buying it, for a given number of meals per week.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "eat_out_price": {"type": "number"},
                "cook_price": {"type": "number"},
                "meals_per_week": {"type": "integer"},
                "calories_out": {"type": "integer"},
                "calories_cooked": {"type": "integer"},
            },
            "required": [
                "eat_out_price",
                "cook_price",
                "meals_per_week",
                "calories_out",
                "calories_cooked",
            ],
            "additionalProperties": False,
        },
    },
    {
        "name": "task_status",
        "description": "List the user's open tasks and how many they have completed.",
        "strict": True,
        "input_schema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    },
]


def execute_tool(name: str, tool_input: dict[str, Any], snapshot: Snapshot) -> dict[str, Any]:
    """Dispatch a tool call. Errors are returned, not raised, so the loop keeps going."""
    try:
        if name == "spending_by_category":
            return spending_by_category(snapshot, tool_input.get("necessity"))
        if name == "list_transactions":
            return list_transactions(
                snapshot,
                tool_input.get("category"),
                float(tool_input.get("min_amount", 0) or 0),
                int(tool_input.get("limit", 25) or 25),
            )
        if name == "merchant_frequency":
            return merchant_frequency(snapshot, int(tool_input.get("limit", 10) or 10))
        if name == "time_breakdown":
            return time_breakdown(snapshot)
        if name == "budget_status":
            return budget_status(snapshot)
        if name == "savings_projection":
            cuts = {c["category"]: c["weekly_amount"] for c in tool_input.get("cuts", [])}
            return savings_projection(cuts)
        if name == "meal_savings":
            return meal_savings(
                float(tool_input["eat_out_price"]),
                float(tool_input["cook_price"]),
                int(tool_input["meals_per_week"]),
                int(tool_input["calories_out"]),
                int(tool_input["calories_cooked"]),
            )
        if name == "task_status":
            return task_status(snapshot)
        return {"error": f"Unknown tool: {name}"}
    except Exception as exc:  # surfaced back to the model as a tool error
        return {"error": f"{type(exc).__name__}: {exc}"}
