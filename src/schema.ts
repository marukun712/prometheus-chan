import { AgentSeqSchema } from "@kokoro/rig";
import { z } from "zod";

const SplitStringSchema = z.string().transform((s) => s.split(","));

export const LevelSchema = z.object({
	name: z.string(),
	label: z.string(),
	color: z.string(),
	move: z.string().optional(),
});
export type Level = z.infer<typeof LevelSchema>;

export const PartSchema = z.object({
	id: z.string(),
	label: z.string(),
});
export type Part = z.infer<typeof PartSchema>;

export const GroupSchema = z.object({
	name: z.string(),
	layers: z.array(z.string()),
});
export type Group = z.infer<typeof GroupSchema>;

export const MoveSchema = z.object({
	name: z.string(),
	groups: z.array(
		z.object({
			name: z.string(),
			seq: AgentSeqSchema,
		}),
	),
});

export type Move = z.infer<typeof MoveSchema>;

export const PackSchema = z.object({
	id: z.string(),
	name: z.string(),
	psd: z.string(),
	groups: z.array(GroupSchema),
	moves: z.array(MoveSchema),
	levels: z.array(
		LevelSchema.extend({
			enter: z.number(),
			exit: z.number().optional(),
		}),
	),
});
export type Pack = z.infer<typeof PackSchema>;

const SaysSchema = z.array(
	z.object({
		line: z.string(),
		voice: z.string(),
		move: z.string().optional(),
	}),
);

export const ProfileSchema = z.object({
	parts: z.array(
		PartSchema.extend({
			on: z.array(
				z.object({
					from: SplitStringSchema,
					to: z.string(),
					says: SaysSchema,
				}),
			),
			ask: z.array(
				z.object({
					level: SplitStringSchema,
					says: SaysSchema,
				}),
			),
			care: z.array(
				z.object({
					level: SplitStringSchema,
					line: z.string(),
				}),
			),
		}),
	),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const MetricSchema = z.object({
	prometheus: z.object({
		url: z.string(),
		interval: z.string(),
	}),
	server: z.object({
		port: z.number(),
	}),
	signals: z.array(
		z.object({
			part: z.string(),
			query: z.string(),
		}),
	),
});
export type Metric = z.infer<typeof MetricSchema>;

export const MessageSchema = z.object({
	part: z.string(),
	text: z.string(),
	voice: z.string(),
	move: z.string().optional(),
	level: z.string(),
	time: z.number(),
});
export type Message = z.infer<typeof MessageSchema>;

export const StateSchema = z.object({
	psd: z.string(),
	groups: z.array(GroupSchema),
	moves: z.array(MoveSchema),
	levels: z.array(LevelSchema),
	parts: z.array(PartSchema),
	levelState: z.record(z.string(), z.string()),
});
export type State = z.infer<typeof StateSchema>;

const LabelsSchema = z.record(z.string(), z.string());

const SamplePairSchema = z.tuple([z.number(), z.string()]);

const HistogramSchema = z.object({
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

const HistogramPairSchema = z.tuple([z.number(), HistogramSchema]);

export const QueryDataSchema = z.discriminatedUnion("resultType", [
	z.object({
		resultType: z.literal("vector"),
		result: z.array(
			z.object({
				metric: LabelsSchema,
				value: SamplePairSchema.optional(),
				histogram: HistogramPairSchema.optional(),
			}),
		),
	}),
	z.object({
		resultType: z.literal("matrix"),
		result: z.array(
			z.object({
				metric: LabelsSchema,
				values: z.array(SamplePairSchema).optional(),
				histograms: z.array(HistogramPairSchema).optional(),
			}),
		),
	}),
	z.object({
		resultType: z.literal("scalar"),
		result: SamplePairSchema,
	}),
	z.object({
		resultType: z.literal("string"),
		result: SamplePairSchema,
	}),
]);
export type QueryData = z.infer<typeof QueryDataSchema>;

const Annotations = {
	warnings: z.array(z.string()).optional(),
	infos: z.array(z.string()).optional(),
};

export const QueryResponseSchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("success"),
		data: QueryDataSchema,
		...Annotations,
	}),
	z.object({
		status: z.literal("error"),
		errorType: z.string(),
		error: z.string(),
		...Annotations,
	}),
]);
export type QueryResponse = z.infer<typeof QueryResponseSchema>;
export type QuerySuccess = Extract<QueryResponse, { status: "success" }>;
