import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { buildSnapshot } from "../lib/snapshot.js";
import { agentService } from "../lib/agents.js";

export const chatRouter = Router();
chatRouter.use(requireAuth);

chatRouter.get("/threads", async (req: AuthedRequest, res) => {
  const threads = await prisma.chatThread.findMany({
    where: { userId: req.userId! },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  res.json({ threads });
});

chatRouter.post("/threads", async (req: AuthedRequest, res) => {
  const thread = await prisma.chatThread.create({
    data: { userId: req.userId!, title: typeof req.body?.title === "string" ? req.body.title : "New chat" },
  });
  res.status(201).json({ thread });
});

chatRouter.get("/threads/:id", async (req: AuthedRequest, res) => {
  const thread = await prisma.chatThread.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }
  res.json({ thread });
});

chatRouter.delete("/threads/:id", async (req: AuthedRequest, res) => {
  await prisma.chatThread.deleteMany({ where: { id: req.params.id, userId: req.userId! } });
  res.status(204).end();
});

/**
 * Streams the coach's reply as Server-Sent Events.
 *
 * The Python agent service owns the model call and the tool loop; this route
 * supplies the user's data snapshot, pipes bytes straight through to the
 * browser, and persists both sides of the exchange once the stream ends.
 */
chatRouter.post("/threads/:id/messages", async (req: AuthedRequest, res) => {
  const parsed = z.object({ content: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const thread = await prisma.chatThread.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 60 } },
  });
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  await prisma.chatMessage.create({
    data: { threadId: thread.id, role: "user", content: parsed.data.content },
  });
  if (thread.title === "New chat") {
    await prisma.chatThread.update({
      where: { id: thread.id },
      data: { title: parsed.data.content.slice(0, 60) },
    });
  }

  const snapshot = await buildSnapshot(req.userId!);
  const history = [
    ...thread.messages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: parsed.data.content },
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let assistantText = "";

  try {
    const upstream = await agentService.chatStream({ snapshot, messages: history });
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      res.write(`event: error\ndata: ${JSON.stringify({ message: `Agent service error: ${detail.slice(0, 300)}` })}\n\n`);
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      res.write(chunk);

      // Mirror text deltas so the finished reply can be persisted.
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim());
            if (payload.type === "text" && typeof payload.text === "string") assistantText += payload.text;
          } catch {
            /* keep-alive or non-JSON frame */
          }
        }
      }
    }
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: (err as Error).message })}\n\n`);
  } finally {
    if (assistantText.trim()) {
      await prisma.chatMessage.create({
        data: { threadId: thread.id, role: "assistant", content: assistantText },
      });
      await prisma.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
    }
    res.end();
  }
});
