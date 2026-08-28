"""Multi-agent workflows.

    Friday  weekly_review  ->  4 specialists in parallel -> chief strategist
    Monday  monday_plan    ->  budget architect + meal strategist in parallel
                               -> game plan coach

Running the specialists concurrently keeps a five-agent review inside a normal
request window, and giving them all the identical snapshot means the strategist
never has to reconcile different views of the same week.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from . import agents, config
from .schemas import (
    BudgetAdvice,
    CashFlowReport,
    MealReport,
    MondayPlanOutput,
    NextWeekPlan,
    SpendingReport,
    StrategistOutput,
    TimeReport,
)
from .tools import merchant_frequency, spending_by_category, time_breakdown


def _facts(snapshot: dict[str, Any]) -> str:
    """The deterministic figures every agent is anchored to."""
    return json.dumps(
        {
            "period": snapshot.get("period"),
            "user": snapshot.get("user"),
            "totals": snapshot.get("totals"),
            "plan": snapshot.get("plan"),
            "accounts": snapshot.get("accounts"),
            "prior_weeks": snapshot.get("priorWeeks"),
            "computed_spending_by_category": spending_by_category(snapshot),
            "computed_merchants": merchant_frequency(snapshot, 15),
            "computed_time": time_breakdown(snapshot),
        },
        indent=2,
        default=str,
    )


def _transactions(snapshot: dict[str, Any]) -> str:
    return json.dumps(snapshot.get("expenses", []), indent=2, default=str)


def _activities(snapshot: dict[str, Any]) -> str:
    return json.dumps(
        {
            "activities": snapshot.get("activities", []),
            "work_logs": snapshot.get("workLogs", []),
            "tasks": snapshot.get("tasks", []),
        },
        indent=2,
        default=str,
    )


# ------------------------------------------------------------ weekly review

async def weekly_review(snapshot: dict[str, Any]) -> dict[str, Any]:
    facts = _facts(snapshot)
    transactions = _transactions(snapshot)
    activities = _activities(snapshot)

    spending_task = agents.structured_call(
        system=agents.SPENDING_SYSTEM,
        prompt=f"Week under review.\n\nFACTS:\n{facts}\n\nEVERY TRANSACTION:\n{transactions}\n\nProduce your spending forensics report.",
        output_model=SpendingReport,
    )
    cashflow_task = agents.structured_call(
        system=agents.CASHFLOW_SYSTEM,
        prompt=f"Week under review.\n\nFACTS:\n{facts}\n\nEVERY TRANSACTION:\n{transactions}\n\nProduce your cash flow report and explain, structurally, why this user is short on money.",
        output_model=CashFlowReport,
    )
    time_task = agents.structured_call(
        system=agents.TIME_SYSTEM,
        prompt=f"Week under review.\n\nFACTS:\n{facts}\n\nTIME AND TASK LOG:\n{activities}\n\nProduce your time audit and link it to the spending.",
        output_model=TimeReport,
    )
    meal_task = agents.structured_call(
        system=agents.MEAL_SYSTEM,
        prompt=f"Week under review.\n\nFACTS:\n{facts}\n\nEVERY TRANSACTION:\n{transactions}\n\nDesign the replacement meal plan. Remember the 2000-calorie minimum saving across the week.",
        output_model=MealReport,
    )

    spending, cashflow, timing, meals = await asyncio.gather(
        spending_task, cashflow_task, time_task, meal_task
    )

    strategist = await agents.structured_call(
        system=agents.STRATEGIST_SYSTEM,
        prompt=(
            "You are writing the Friday review for this user.\n\n"
            f"FACTS:\n{facts}\n\n"
            f"SPENDING FORENSICS:\n{spending.model_dump_json(indent=2)}\n\n"
            f"CASH FLOW ANALYSIS:\n{cashflow.model_dump_json(indent=2)}\n\n"
            f"TIME AUDIT:\n{timing.model_dump_json(indent=2)}\n\n"
            f"MEAL STRATEGY:\n{meals.model_dump_json(indent=2)}\n\n"
            "Write the post-mortem and next week's game plan."
        ),
        output_model=StrategistOutput,
        max_tokens=config.MAX_TOKENS_STRATEGIST,
        effort=config.EFFORT_STRATEGIST,
    )

    return {
        "breakdown": {
            "by_category": spending_by_category(snapshot)["categories"],
            "want_vs_need": spending.want_vs_need,
            "biggest_category": spending.biggest_category,
            "total_avoidable": spending.total_avoidable,
            "grade": strategist.grade,
            "top_three_moves": strategist.top_three_moves,
            "meals": [m.model_dump() for m in meals.meals],
            "grocery_list": meals.grocery_list,
            "calories_saved_estimate": meals.calories_saved_estimate,
        },
        "agent_reports": {
            "spending_forensics": spending.model_dump(),
            "cash_flow": cashflow.model_dump(),
            "time_audit": timing.model_dump(),
            "meal_strategy": meals.model_dump(),
        },
        "narrative": strategist.narrative,
        "wasted_spend": strategist.wasted_spend,
        "could_have_saved": strategist.could_have_saved,
        "next_week_plan": strategist.next_week_plan.model_dump(),
    }


# -------------------------------------------------------------- monday plan

async def monday_plan(snapshot: dict[str, Any], intake: dict[str, Any]) -> dict[str, Any]:
    facts = _facts(snapshot)
    intake_json = json.dumps(intake, indent=2, default=str)
    plan_json = json.dumps(snapshot.get("plan"), indent=2, default=str)
    calorie_target = intake.get("calorie_target", 2000)
    diet_notes = intake.get("diet_notes") or "no dietary restrictions given"

    budget_task = agents.structured_call(
        system=agents.BUDGET_SYSTEM,
        prompt=(
            f"FACTS ABOUT RECENT WEEKS:\n{facts}\n\n"
            f"WHAT THE USER SAYS THEY WILL SPEND THIS WEEK:\n{plan_json}\n\n"
            f"EXTRA INTAKE:\n{intake_json}\n\n"
            "Give them realistic daily allowances and a weekly cap, and tell them "
            "plainly if their own numbers do not survive contact with their history."
        ),
        output_model=BudgetAdvice,
    )
    meal_task = agents.structured_call(
        system=agents.MEAL_SYSTEM,
        prompt=(
            f"FACTS ABOUT RECENT WEEKS:\n{facts}\n\n"
            f"THIS WEEK'S BUDGET AND GOALS:\n{plan_json}\n\n"
            f"Daily calorie target: {calorie_target}. Dietary notes: {diet_notes}.\n\n"
            "Plan lunch and dinner for all seven days (Monday = day 0). The week's "
            "meals must save at least 2000 calories versus the equivalent takeout, "
            "and must fit inside the daily lunch and dinner budgets above."
        ),
        output_model=MealReport,
    )

    budget, meals = await asyncio.gather(budget_task, meal_task)

    game_plan = await agents.structured_call(
        system=agents.GAMEPLAN_SYSTEM,
        prompt=(
            f"FACTS:\n{facts}\n\n"
            f"USER INTAKE FOR THE WEEK:\n{plan_json}\n{intake_json}\n\n"
            f"APPROVED BUDGET:\n{budget.model_dump_json(indent=2)}\n\n"
            f"MEAL PLAN:\n{meals.model_dump_json(indent=2)}\n\n"
            "Build the day-by-day game plan for Monday through Sunday."
        ),
        output_model=NextWeekPlan,
    )

    result = MondayPlanOutput(
        budget_advice=budget,
        game_plan=game_plan,
        meals=meals.meals,
        calorie_savings_total=meals.calories_saved_estimate,
        notes=meals.notes,
    )
    return result.model_dump()


# ------------------------------------------------------------ quick insight

async def quick_insight(snapshot: dict[str, Any]) -> str:
    """One-line nudge for the dashboard. Cheap model, low effort, called often."""
    facts = _facts(snapshot)
    response = await agents.client().messages.create(
        model=config.FAST_MODEL,
        max_tokens=400,
        system=agents.HOUSE_RULES
        + "\n\nYOUR ROLE: give one short, specific observation about this week so far. "
        "Two sentences maximum. Include a real number from the data.",
        messages=[{"role": "user", "content": f"FACTS:\n{facts}"}],
        thinking={"type": "adaptive"},
        output_config={"effort": "low"},
    )
    return "".join(b.text for b in response.content if b.type == "text").strip()
