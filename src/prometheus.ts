import { QueryResponseSchema, type QuerySuccess } from "./schema.ts";

export async function query(
	promql: string,
	baseUrl = "http://localhost:9090",
): Promise<QuerySuccess> {
	const url = new URL("/api/v1/query", baseUrl);
	url.searchParams.set("query", promql);

	const res = await fetch(url);
	const text = await res.text();

	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
	}

	const parsed = QueryResponseSchema.parse(json);
	if (parsed.status === "error") {
		throw new Error(`${parsed.errorType}: ${parsed.error}`);
	}
	return parsed;
}
