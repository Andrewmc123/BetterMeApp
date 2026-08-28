import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

tasksRouter.get("/", async (req: AuthedRequest, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const tasks = await prisma.task.findMany({
    where: { userId: req.userId!, ...(status ? { status } : {}) },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
  });
  res.json({ tasks });
});

/** Tasks that are due or need a reminder right now — drives the task bar. */
tasksRouter.get("/due", async (req: AuthedRequest, res) => {
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const [overdue, dueSoon, remindNow] = await Promise.all([
    prisma.task.findMany({
      where: { userId: req.userId!, status: "open", dueAt: { lt: now } },
      orderBy: { dueAt: "asc" },
    }),
    prisma.task.findMany({
      where: { userId: req.userId!, status: "open", dueAt: { gte: now, lte: soon } },
      orderBy: { dueAt: "asc" },
    }),
    prisma.task.findMany({
      where: { userId: req.userId!, status: "open", remindAt: { lte: now } },
      orderBy: { remindAt: "asc" },
    }),
  ]);
  res.json({ overdue, dueSoon, remindNow, count: overdue.length + dueSoon.length });
});

const taskInput = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  remindAt: z.string().datetime().nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

tasksRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = taskInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { dueAt, remindAt, ...rest } = parsed.data;
  const task = await prisma.task.create({
    data: {
      ...rest,
      userId: req.userId!,
      dueAt: dueAt ? new Date(dueAt) : null,
      remindAt: remindAt ? new Date(remindAt) : null,
    },
  });
  res.status(201).json({ task });
});

tasksRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = taskInput
    .partial()
    .extend({ status: z.enum(["open", "done", "dropped"]).optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const owned = await prisma.task.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!owned) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const { dueAt, remindAt, status, ...rest } = parsed.data;
  const task = await prisma.task.update({
    where: { id: owned.id },
    data: {
      ...rest,
      ...(status ? { status, completedAt: status === "done" ? new Date() : null } : {}),
      ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
      ...(remindAt !== undefined ? { remindAt: remindAt ? new Date(remindAt) : null } : {}),
    },
  });
  res.json({ task });
});

tasksRouter.delete("/:id", async (req: AuthedRequest, res) => {
  await prisma.task.deleteMany({ where: { id: req.params.id, userId: req.userId! } });
  res.status(204).end();
});
