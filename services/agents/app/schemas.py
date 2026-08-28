"""Structured-output schemas.

Every specialist agent returns one of these instead of prose, so the Node API
can store, chart and diff the results. The chief strategist is the only agent
that writes free-form narrative.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class Leak(BaseModel):
    label: str = Field(description="What the money leak is, e.g. 'DoorDash lunches'")
    category: str
    amount: float = Field(description="Total spent on this leak during the week")
    occurrences: int
    annualized: float = Field(description="amount * 52 if the pattern continues")
    verdict: Literal["cut", "reduce", "keep"]
    reasoning: str


class SpendingReport(BaseModel):
    headline: str = Field(description="One sentence: where the money actually went")
    biggest_category: str
    biggest_category_amount: float
    want_vs_need: dict[str, float] = Field(description="Keys: want, need, unknown")
    leaks: list[Leak]
    repeat_merchants: list[str]
    total_avoidable: float = Field(description="Dollars that were genuinely avoidable this week")
    notes: str


class CashFlowReport(BaseModel):
    headline: str
    earned: float
    spent: float
    net: float
    burn_rate_per_day: float
    days_of_runway: float | None = Field(
        default=None, description="Based on visible account balances; null if unknown"
    )
    why_broke: list[str] = Field(description="Ranked structural reasons, most important first")
    structural_fixes: list[str]
    notes: str


class TimeReport(BaseModel):
    headline: str
    work_hours: float
    effective_hourly_rate: float | None
    hours_by_category: dict[str, float]
    time_money_link: str = Field(description="How time use drove spending this week")
    reclaimable_hours: float
    reclaim_moves: list[str]
    notes: str


class MealIdea(BaseModel):
    day_of_week: int = Field(ge=0, le=6, description="0 = Monday")
    meal: Literal["lunch", "dinner"]
    name: str
    calories: int
    est_cost: float
    ingredients: list[str]
    steps: str
    save_vs_eat_out: float = Field(description="Dollars saved vs the equivalent takeout")


class MealReport(BaseModel):
    headline: str
    spent_eating_out: float
    meals_bought_out: int
    calories_saved_estimate: int = Field(
        description="Calories avoided over the week by cooking these instead of takeout"
    )
    dollars_saved_estimate: float
    meals: list[MealIdea]
    grocery_list: list[str]
    notes: str


class DayPlan(BaseModel):
    day: str
    focus: str
    spend_cap: float
    tasks: list[str]
    meals: str


class NextWeekPlan(BaseModel):
    theme: str
    weekly_spend_cap: float
    daily_lunch_budget: float
    daily_dinner_budget: float
    savings_target: float
    rules: list[str] = Field(description="Hard rules to follow, e.g. 'no delivery apps Mon-Thu'")
    days: list[DayPlan]


class StrategistOutput(BaseModel):
    narrative: str = Field(description="Markdown post-mortem: what happened, what went wrong, what to do")
    wasted_spend: float
    could_have_saved: float
    grade: str = Field(description="Letter grade for the week, A-F")
    top_three_moves: list[str]
    next_week_plan: NextWeekPlan


class BudgetAdvice(BaseModel):
    recommended_daily_lunch: float
    recommended_daily_dinner: float
    recommended_weekly_other: float
    weekly_spend_cap: float
    projected_savings: float
    reasoning: str
    warnings: list[str]


class MondayPlanOutput(BaseModel):
    budget_advice: BudgetAdvice
    game_plan: NextWeekPlan
    meals: list[MealIdea]
    calorie_savings_total: int
    notes: str


# ------------------------------------------------------------------ requests

class SnapshotRequest(BaseModel):
    snapshot: dict[str, Any]


class MondayRequest(BaseModel):
    snapshot: dict[str, Any]
    intake: dict[str, Any] = Field(default_factory=dict)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    snapshot: dict[str, Any]
    messages: list[ChatMessage]
