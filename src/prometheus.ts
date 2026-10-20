import { z } from "zod";

const Metric = z.record(z.string(), z.string());

const SamplePair = z.tuple([z.number(), z.string()]);

const Histogram = z.object({
	count: z.string(),
	sum: z.string(),
	buckets: z
		.array(
			z.tuple([
				z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
				z.string(),
				z.string(),
				z.string(),
			]),
		)
		.optional(),
});

const HistogramPair = z.tuple([z.number(), Histogram]);

const QueryData = z.discriminatedUnion("resultType", [
	z.object({
		resultType: z.literal("vector"),
		result: z.array(
			z.object({
				metric: Metric,
				value: SamplePair.optional(),
				histogram: HistogramPair.optional(),
			}),
		),
	}),
	z.object({
		resultType: z.literal("matrix"),
		result: z.array(
			z.object({
				metric: Metric,
				values: z.array(SamplePair).optional(),
				histograms: z.array(HistogramPair).optional(),
			}),
		),
	}),
	z.object({
		resultType: z.literal("scalar"),
		result: SamplePair,
	}),
	z.object({
		resultType: z.literal("string"),
		result: SamplePair,
	}),
]);

const Annotations = {
	warnings: z.array(z.string()).optional(),
	infos: z.array(z.string()).optional(),
};

const QueryResponse = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("success"),
		data: QueryData,
		...Annotations,
	}),
	z.object({
		status: z.literal("error"),
		errorType: z.string(),
		error: z.string(),
		...Annotations,
	}),
]);

export type QueryData = z.infer<typeof QueryData>;
export type QuerySuccess = Extract<
	z.infer<typeof QueryResponse>,
	{ status: "success" }
>;

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

	const parsed = QueryResponse.parse(json);
	if (parsed.status === "error") {
		throw new Error(`${parsed.errorType}: ${parsed.error}`);
	}
	return parsed;
}
