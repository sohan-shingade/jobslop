interface ExecuteResult {
  rows: Record<string, unknown>[];
  columns: string[];
}

async function execute(
  input: string | { sql: string; args?: unknown[] }
): Promise<ExecuteResult> {
  const sql = typeof input === "string" ? input : input.sql;
  const params = typeof input === "string" ? [] : (input.args ?? []);

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
