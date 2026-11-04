interface ExecuteResult {
  rows: Record<string, unknown>[];
  columns: string[];
}

type LocalDb = { prepare(sql: string): { all(...params: unknown[]): Record<string, unknown>[] } };
let localDb: LocalDb | undefined;

function executeLocal(sql: string, params: unknown[]): ExecuteResult {
  if (!localDb) {
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as unknown as {
      DatabaseSync: new (path: string, options: { readOnly: boolean }) => LocalDb;
    };
    localDb = new DatabaseSync(process.env.JOBSLOP_SQLITE!, { readOnly: true });
  }
  // Plain objects: node:sqlite rows have no prototype, which React can't pass to client components.
  const rows = localDb.prepare(sql).all(...params).map((row) => ({ ...row }));
  return { rows, columns: rows.length > 0 ? Object.keys(rows[0]) : [] };
}

async function execute(
  input: string | { sql: string; args?: unknown[] }
): Promise<ExecuteResult> {
  const sql = typeof input === "string" ? input : input.sql;
  const params = typeof input === "string" ? [] : (input.args ?? []);

  if (process.env.JOBSLOP_SQLITE) {
    return executeLocal(sql, params);
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCT_ID}/d1/database/${process.env.CLOUDFLARE_DB_ID}/query`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
    cache: "no-store",
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`D1 API error (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  if (!data.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(data.errors)}`);
  }

  const rows = data.result?.[0]?.results ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return { rows, columns };
}

export const db = { execute };
