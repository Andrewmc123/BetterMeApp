"""FastAPI surface for the BetterMe agent service.

Only the Node API talks to this service; requests are authenticated with a
shared secret rather than user tokens.
"""

from __future__ import annotations

import logging

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse

from . import config, orchestrator
from .chat import stream_chat
from .schemas import ChatRequest, MondayRequest, SnapshotRequest

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("betterme.agents")

app = FastAPI(title="BetterMe Agents", version="1.0.0")


async def verify_secret(x_agents_secret: str | None = Header(default=None)) -> None:
    if x_agents_secret != config.SHARED_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "model": config.MODEL,
        "fast_model": config.FAST_MODEL,
        "api_key_configured": config.api_key_present(),
    }


@app.post("/agents/weekly-review", dependencies=[Depends(verify_secret)])
async def weekly_review(req: SnapshotRequest) -> dict[str, object]:
    try:
        return await orchestrator.weekly_review(req.snapshot)
    except Exception as exc:
        log.exception("weekly review failed")
        raise HTTPException(status_code=502, detail=f"{type(exc).__name__}: {exc}") from exc


@app.post("/agents/monday-plan", dependencies=[Depends(verify_secret)])
async def monday_plan(req: MondayRequest) -> dict[str, object]:
    try:
        return await orchestrator.monday_plan(req.snapshot, req.intake)
    except Exception as exc:
        log.exception("monday plan failed")
        raise HTTPException(status_code=502, detail=f"{type(exc).__name__}: {exc}") from exc


@app.post("/agents/quick-insight", dependencies=[Depends(verify_secret)])
async def quick_insight(req: SnapshotRequest) -> dict[str, str]:
    try:
        return {"insight": await orchestrator.quick_insight(req.snapshot)}
    except Exception as exc:
        log.exception("quick insight failed")
        raise HTTPException(status_code=502, detail=f"{type(exc).__name__}: {exc}") from exc


@app.post("/agents/chat", dependencies=[Depends(verify_secret)])
async def chat(req: ChatRequest) -> StreamingResponse:
    history = [{"role": m.role, "content": m.content} for m in req.messages]
    return StreamingResponse(
        stream_chat(req.snapshot, history),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
