import { z } from "zod";

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class IndexerError extends Error {
  override readonly name = "IndexerError";
  constructor(
    readonly queryName: string,
    message: string,
  ) {
    super(`${queryName}: ${message}`);
  }
}

export async function gql<T>(args: {
  url: string;
  queryName: string;
  query: string;
  variables?: Record<string, unknown>;
  schema: z.ZodType<T>;
  fetchImpl?: Fetch;
}): Promise<T> {
  const fetchImpl = args.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(args.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: args.query, variables: args.variables ?? {} }),
    });
  } catch (error) {
    throw new IndexerError(args.queryName, `network error: ${(error as Error).message}`);
  }
  if (!response.ok) throw new IndexerError(args.queryName, `HTTP ${response.status}`);
  const body = (await response.json()) as { data?: unknown; errors?: { message: string }[] };
  if (body.errors?.length)
    throw new IndexerError(args.queryName, body.errors.map((e) => e.message).join("; "));
  const parsed = args.schema.safeParse(body.data);
  if (!parsed.success) throw new IndexerError(args.queryName, `unexpected response: ${parsed.error.message}`);
  return parsed.data;
}

const PAGE_SIZE = 1000;

type RawRow = Record<string, unknown> & { id: string };

/**
 * Newest-first keyset pagination on (orderField, id), returned oldest-first.
 * Stops at `maxRows` (truncated) or at the first short page.
 */
export async function paginateDesc<Row>(args: {
  url: string;
  queryName: string;
  table: string;
  fields: string;
  where: string;
  orderField: "timestamp" | "createdAt";
  rowSchema: z.ZodType<Row>;
  maxRows: number;
  fetchImpl?: Fetch;
}): Promise<{ rows: Row[]; truncated: boolean }> {
  const { table, orderField } = args;
  const raw: RawRow[] = [];
  let truncated = false;
  for (;;) {
    const last = raw.at(-1);
    const cursor = last
      ? `, {_or: [{${orderField}: {_lt: "${last[orderField]}"}}, {${orderField}: {_eq: "${last[orderField]}"}, id: {_lt: "${last.id}"}}]}`
      : "";
    const query = `query ${args.queryName} { ${table}(where: {_and: [${args.where}${cursor}]}, order_by: [{${orderField}: desc}, {id: desc}], limit: ${PAGE_SIZE}) { ${args.fields} } }`;
    const data = await gql<Record<string, RawRow[]>>({
      url: args.url,
      queryName: args.queryName,
      query,
      schema: z.object({ [table]: z.array(z.looseObject({ id: z.string() })) }) as z.ZodType<
        Record<string, RawRow[]>
      >,
      fetchImpl: args.fetchImpl,
    });
    const page = data[table] ?? [];
    raw.push(...page);
    if (raw.length >= args.maxRows) {
      truncated = page.length === PAGE_SIZE || raw.length > args.maxRows;
      raw.length = Math.min(raw.length, args.maxRows);
      break;
    }
    if (page.length < PAGE_SIZE) break;
  }
  const rows = raw.reverse().map((r, i) => {
    const parsed = args.rowSchema.safeParse(r);
    if (!parsed.success) throw new IndexerError(args.queryName, `row ${i}: ${parsed.error.message}`);
    return parsed.data;
  });
  return { rows, truncated };
}
