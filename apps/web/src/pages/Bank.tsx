import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { api, money } from "../api";

interface Account {
  id: string;
  name: string;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
}
interface Item {
  id: string;
  institutionName: string;
  lastSyncedAt: string | null;
  accounts: Account[];
}
interface Status {
  configured: boolean;
  environment: string;
  items: Item[];
}

export function Bank() {
  const [status, setStatus] = useState<Status | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.get<Status>("/bank/status"));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startLink = async () => {
    setError(null);
    setBusy(true);
    try {
      const { linkToken } = await api.post<{ linkToken: string }>("/bank/link-token", {});
      setLinkToken(linkToken);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken, metadata) => {
      setBusy(true);
      try {
        const res = await api.post<{ imported: number }>("/bank/exchange", {
          publicToken,
          institutionName: metadata.institution?.name,
        });
        setMessage(`Connected. Imported ${res.imported} transactions.`);
        setLinkToken(null);
        void load();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    onExit: () => setLinkToken(null),
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  const sync = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ imported: number }>("/bank/sync", {});
      setMessage(`Synced. ${res.imported} new transactions imported.`);
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Bank connection</h1>
      <p className="muted small" style={{ marginTop: "-.3rem" }}>
        Connecting your bank pulls transactions in automatically, so you only have to log the things
        cash and cards miss. Access tokens are encrypted before they touch the database.
      </p>

      {error && <div className="banner error">{error}</div>}
      {message && <div className="banner ok">{message}</div>}

      {status && !status.configured && (
        <div className="banner">
          Bank linking isn't configured on this deployment yet. Add <code>PLAID_CLIENT_ID</code> and{" "}
          <code>PLAID_SECRET</code> to the API service's environment, then reload this page. Until then
          you can log spending by hand on the Daily log page.
        </div>
      )}

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="row">
          <button onClick={() => void startLink()} disabled={busy || !status?.configured}>
            {busy ? "Working…" : "Connect a bank account"}
          </button>
          {status && status.items.length > 0 && (
            <button className="ghost" onClick={() => void sync()} disabled={busy}>
              Sync now
            </button>
          )}
          {status && <span className="tag">environment: {status.environment}</span>}
        </div>
      </div>

      {status?.items.map((item) => (
        <div className="card" key={item.id} style={{ marginBottom: "1rem" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>{item.institutionName}</h3>
            <span className="muted small">
              {item.lastSyncedAt ? `synced ${new Date(item.lastSyncedAt).toLocaleString()}` : "never synced"}
            </span>
          </div>
          <table style={{ marginTop: ".6rem" }}>
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th style={{ textAlign: "right" }}>Available</th>
                <th style={{ textAlign: "right" }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {item.accounts.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.name} {a.mask && <span className="muted">····{a.mask}</span>}
                  </td>
                  <td className="muted small">{a.subtype ?? a.type}</td>
                  <td style={{ textAlign: "right" }}>{money(a.availableBalance)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{money(a.currentBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="small danger"
            style={{ marginTop: ".6rem" }}
            onClick={async () => {
              await api.del(`/bank/items/${item.id}`);
              void load();
            }}
          >
            Disconnect
          </button>
        </div>
      ))}
    </>
  );
}
