import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./lib/env.js";
import { requireCronSecret } from "./lib/auth.js";
import { agentService } from "./lib/agents.js";
import { authRouter } from "./routes/auth.js";
import { logRouter } from "./routes/log.js";
import { tasksRouter } from "./routes/tasks.js";
import { planningRouter } from "./routes/planning.js";
import { bankRouter } from "./routes/bank.js";
import { chatRouter } from "./routes/chat.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { bankSyncJob, fridayReviewJob, mondayPromptJob, startScheduler } from "./scheduler.js";

const app = express();

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: env.isProd ? [env.webOrigin] : true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.isProd ? "combined" : "dev"));

app.get("/api/health", async (_req, res) => {
  const agents = await agentService.health();
  res.json({ ok: true, env: env.nodeEnv, agents });
});

app.use("/api/auth", authRouter);
app.use("/api/log", logRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/planning", planningRouter);
app.use("/api/bank", bankRouter);
app.use("/api/chat", chatRouter);
app.use("/api/dashboard", dashboardRouter);

/* Cron endpoints — for Render Cron Jobs, guarded by X-Cron-Secret. */
app.post("/api/cron/friday-review", requireCronSecret, async (_req, res) => {
  res.json(await fridayReviewJob());
});
app.post("/api/cron/monday-prompt", requireCronSecret, async (_req, res) => {
  res.json(await mondayPromptJob());
});
app.post("/api/cron/bank-sync", requireCronSecret, async (_req, res) => {
  res.json(await bankSyncJob());
});

/* In production the API also serves the built React app. */
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.json({ service: "BetterMe API", docs: "/api/health" });
  });
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[error]", err);
  res.status(500).json({ error: env.isProd ? "Something went wrong" : err.message });
});

app.listen(env.port, () => {
  console.log(`BetterMe API listening on :${env.port} (${env.nodeEnv})`);
  startScheduler();
});
