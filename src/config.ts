import type { Document, Node } from "@bgotink/kdl";
import { parseCompat } from "@bgotink/kdl/v1-compat";
import { z } from "zod";

const arg = (n: Node | undefined, i = 0) => n?.getArgument(i);
const childArg = (n: Node | undefined, name: string) =>
	arg(n?.children?.findNodeByName(name));

export const Character = z.object({
	id: z.string(),
	name: z.string(),
	firstPerson: z.string(),
	levels: z.array(
		z.object({
			name: z.string(),
			enter: z.number(),
			exit: z.number().optional(),
		}),
	),
	parts: z.array(
		z.object({
			id: z.string(),
			label: z.string(),
		}),
	),
	events: z.array(
		z.object({
			part: z.string().optional(),
			from: z.string().transform((s) => s.split(",")),
			to: z.string(),
			says: z.array(
				z.object({
					text: z.string(),
					voice: z.string(),
				}),
			),
		}),
	),
});
export type Character = z.infer<typeof Character>;

function readCharacter(doc: Document) {
	const c = doc.findNodeByName("character");
	return {
		id: arg(c),
		name: childArg(c, "name"),
		firstPerson: childArg(c, "first-person"),
		levels: doc.findNodeByName("levels")?.children?.nodes.map((n) => ({
			name: n.getName(),
			enter: n.getProperty("enter"),
			exit: n.getProperty("exit"),
		})),
		parts: doc.findNodesByName("part").map((n) => ({
			id: arg(n, 0),
			label: arg(n, 1),
		})),
		events: doc.findNodesByName("on").map((n) => ({
			part: arg(n),
			from: n.getProperty("from"),
			to: n.getProperty("to"),
			says: n.children?.findNodesByName("say").map((s) => ({
				text: arg(s, 0),
				voice: arg(s, 1),
			})),
		})),
	};
}

export const Metric = z.object({
	prometheus: z.object({
		url: z.string(),
		interval: z.string(),
	}),
	signals: z.array(
		z.object({
			part: z.string(),
			query: z.string(),
		}),
	),
});
export type Metric = z.infer<typeof Metric>;

function readMetric(doc: Document) {
	const p = doc.findNodeByName("prometheus");
	return {
		prometheus: {
			url: p?.getProperty("url"),
			interval: p?.getProperty("interval"),
		},
		signals: doc.findNodesByName("signal").map((n) => ({
			part: arg(n),
			query: childArg(n, "query"),
		})),
	};
}

function load<T>(
	path: string,
	read: (doc: Document) => unknown,
	schema: z.ZodType<T>,
): T {
	const result = schema.safeParse(
		read(parseCompat(Deno.readTextFileSync(path))),
	);
	if (!result.success) {
		console.error(`${path} の設定が不正です`, result.error.issues);
		Deno.exit(1);
	}
	return result.data;
}

export const loadCharacter = (path: string) =>
	load(path, readCharacter, Character);
export const loadMetric = (path: string) => load(path, readMetric, Metric);
