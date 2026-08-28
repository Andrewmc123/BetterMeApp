import { Router } from "express";
import { z } from "zod";
import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { env, plaidConfigured } from "../lib/env.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { startOfDay } from "../lib/dates.js";

export const bankRouter = Router();
bankRouter.use(requireAuth);

let client: PlaidApi | null = null;
function plaid(): PlaidApi {
  if (!plaidConfigured) {
    throw new Error(
      "Bank connection is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to your environment.",
    );
  }
  if (!client) {
    client = new PlaidApi(
      new Configuration({
        basePath: PlaidEnvironments[env.plaidEnv],
        baseOptions: {
          headers: {
            "PLAID-CLIENT-ID": env.plaidClientId,
            "PLAID-SECRET": env.plaidSecret,
          },
        },
      }),
    );
  }
  return client;
}

/** Plaid's personal finance categories -> the app's spending buckets. */
const CATEGORY_MAP: Record<string, string> = {
  FOOD_AND_DRINK: "food_out",
  GENERAL_MERCHANDISE: "shopping",
  TRANSPORTATION: "transport",
  TRAVEL: "transport",
  RENT_AND_UTILITIES: "bills",
  LOAN_PAYMENTS: "bills",
  MEDICAL: "health",
  PERSONAL_CARE: "health",
  ENTERTAINMENT: "fun",
  GENERAL_SERVICES: "other",
  GOVERNMENT_AND_NON_PROFIT: "other",
  HOME_IMPROVEMENT: "shopping",
  INCOME: "other",
  TRANSFER_IN: "other",
  TRANSFER_OUT: "other",
  BANK_FEES: "bills",
};

function mapCategory(primary?: string | null, detailed?: string | null): string {
  if (detailed?.includes("GROCERIES")) return "groceries";
  if (detailed?.includes("SUBSCRIPTION") || detailed?.includes("STREAMING")) return "subscriptions";
  if (detailed?.includes("RENT")) return "rent";
  return CATEGORY_MAP[primary ?? ""] ?? "other";
}

bankRouter.get("/status", async (req: AuthedRequest, res) => {
  const items = await prisma.bankItem.findMany({
    where: { userId: req.userId! },
    include: { accounts: true },
  });
  res.json({
    configured: plaidConfigured,
    environment: env.plaidEnv,
    items: items.map((i) => ({
      id: i.id,
      institutionName: i.institutionName,
      lastSyncedAt: i.lastSyncedAt,
      accounts: i.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
        currentBalance: a.currentBalance,
        availableBalance: a.availableBalance,
      })),
    })),
  });
});

/** Step 1 — the browser opens Plaid Link with this token. */
bankRouter.post("/link-token", async (req: AuthedRequest, res) => {
  try {
    const response = await plaid().linkTokenCreate({
      user: { client_user_id: req.userId! },
      client_name: "BetterMe",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    res.json({ linkToken: response.data.link_token });
  } catch (err) {
    res.status(502).json({ error: describePlaidError(err) });
  }
});

/** Step 2 — exchange the public token Link returns for a long-lived access token. */
bankRouter.post("/exchange", async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ publicToken: z.string().min(1), institutionName: z.string().optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  try {
    const exchange = await plaid().itemPublicTokenExchange({ public_token: parsed.data.publicToken });
    const accessToken = exchange.data.access_token;
    const item = await prisma.bankItem.upsert({
      where: { plaidItemId: exchange.data.item_id },
      create: {
        userId: req.userId!,
        plaidItemId: exchange.data.item_id,
        accessTokenEnc: encrypt(accessToken),
        institutionName: parsed.data.institutionName ?? "Bank",
      },
      update: { accessTokenEnc: encrypt(accessToken) },
    });
    const result = await syncItem(item.id);
    res.json({ itemId: item.id, ...result });
  } catch (err) {
    res.status(502).json({ error: describePlaidError(err) });
  }
});

bankRouter.post("/sync", async (req: AuthedRequest, res) => {
  const items = await prisma.bankItem.findMany({ where: { userId: req.userId! } });
  if (items.length === 0) {
    res.status(400).json({ error: "No bank connected yet." });
    return;
  }
  try {
    let imported = 0;
    for (const item of items) imported += (await syncItem(item.id)).imported;
    res.json({ imported });
  } catch (err) {
    res.status(502).json({ error: describePlaidError(err) });
  }
});

bankRouter.delete("/items/:id", async (req: AuthedRequest, res) => {
  await prisma.bankItem.deleteMany({ where: { id: req.params.id, userId: req.userId! } });
  res.status(204).end();
});

/**
 * Pulls new transactions with Plaid's cursor-based sync and turns outflows into
 * expenses. Existing rows are keyed on plaidTxnId so re-running is safe.
 */
export async function syncItem(bankItemId: string): Promise<{ imported: number }> {
  const item = await prisma.bankItem.findUniqueOrThrow({ where: { id: bankItemId } });
  const accessToken = decrypt(item.accessTokenEnc);
  const api = plaid();

  const accounts = await api.accountsGet({ access_token: accessToken });
  for (const acct of accounts.data.accounts) {
    await prisma.bankAccount.upsert({
      where: { plaidAccountId: acct.account_id },
      create: {
        bankItemId: item.id,
        plaidAccountId: acct.account_id,
        name: acct.name,
        mask: acct.mask ?? null,
        type: String(acct.type ?? ""),
        subtype: acct.subtype ? String(acct.subtype) : null,
        currentBalance: acct.balances.current ?? null,
        availableBalance: acct.balances.available ?? null,
      },
      update: {
        name: acct.name,
        currentBalance: acct.balances.current ?? null,
        availableBalance: acct.balances.available ?? null,
      },
    });
  }
  if (accounts.data.item.institution_id && item.institutionName === "Bank") {
    await prisma.bankItem.update({
      where: { id: item.id },
      data: { institutionName: accounts.data.item.institution_id },
    });
  }

  let cursor = item.cursor ?? undefined;
  let hasMore = true;
  let imported = 0;

  while (hasMore) {
    const page = await api.transactionsSync({ access_token: accessToken, cursor, count: 250 });
    for (const txn of page.data.added) {
      // Plaid reports outflows as positive amounts; skip refunds and inbound money.
      if (txn.amount <= 0) continue;
      await prisma.expense.upsert({
        where: { plaidTxnId: txn.transaction_id },
        create: {
          userId: item.userId,
          date: startOfDay(txn.date),
          amount: Number(txn.amount.toFixed(2)),
          category: mapCategory(
            txn.personal_finance_category?.primary,
            txn.personal_finance_category?.detailed,
          ),
          merchant: txn.merchant_name ?? txn.name,
          description: txn.name,
          source: "plaid",
          plaidTxnId: txn.transaction_id,
        },
        update: {},
      });
      imported += 1;
    }
    for (const removed of page.data.removed) {
      await prisma.expense.deleteMany({ where: { plaidTxnId: removed.transaction_id } });
    }
    cursor = page.data.next_cursor;
    hasMore = page.data.has_more;
  }

  await prisma.bankItem.update({
    where: { id: item.id },
    data: { cursor, lastSyncedAt: new Date() },
  });
  return { imported };
}

function describePlaidError(err: unknown): string {
  const anyErr = err as { response?: { data?: { error_message?: string; error_code?: string } }; message?: string };
  return (
    anyErr.response?.data?.error_message ??
    anyErr.response?.data?.error_code ??
    anyErr.message ??
    "Unknown bank error"
  );
}
