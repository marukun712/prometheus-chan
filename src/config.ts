import type { Document, Node } from "@bgotink/kdl";
import { parseCompat } from "@bgotink/kdl/v1-compat";
import { z } from "zod";

const arg = (n: Node | undefined, i = 0) => n?.getArgument(i);
const childArg = (n: Node | undefined, name: string) =>
	arg(n?.children?.findNodeByName(name));

export const CharacterSchema = z.object({
	id: z.string(),
	name: z.string(),
	levels: z.array(
		z.object({
			name: z.string(),
			enter: z.number(),
			exit: z.number().optional(),
			voices: z.array(z.string()),
			image: z.string(),
		}),
	),
	parts: z.array(
		z.object({
			id: z.string(),
			label: z.string(),
		}),
	),
	on: z.array(
		z.object({
			part: z.string().optional(),
			from: z.string().transform((s) => s.split(",")),
			to: z.string(),
			says: z.array(
				z.object({
					line: z.string(),
					voice: z.string().optional(),
					image: z.string().optional(),
				}),
			),
		}),
	),
	events: z.array(z.string()),
	react: z.array(
		z.object({
			event: z.string(),
			when: z.enum(["rise", "fall"]),
			says: z.array(
				z.object({
					line: z.string(),
					voice: z.string().optional(),
					image: z.string().optional(),
				}),
			),
		}),
	),
});
export type Character = z.infer<typeof CharacterSchema>;

function readCharacter(doc: Document) {
	return {
		id: arg(doc.findNodeByName("character")),
		name: childArg(doc.findNodeByName("character"), "name"),
		levels: doc.findNodeByName("levels")?.children?.nodes.map((n) => ({
			name: n.getName(),
			enter: n.getProperty("enter"),
			exit: n.getProperty("exit"),
			voices: n.children?.findNodesByName("voice").map((v) => arg(v)) ?? [],
			image: childArg(n, "image"),
		})),
		parts: doc.findNodesByName("part").map((n) => ({
			id: arg(n, 0),
			label: arg(n, 1),
		})),
		on: doc.findNodesByName("on").map((n) => ({
			part: arg(n),
			from: n.getProperty("from"),
			to: n.getProperty("to"),
			says: n.children?.findNodesByName("say").map((n) => ({
				line: n.getProperty("line"),
				voice: n.getProperty("voice"),
				image: n.getProperty("image"),
			})),
		})),
		events: doc.findNodesByName("event").map((n) => arg(n)),
		react: doc.findNodesByName("react").map((n) => ({
			event: arg(n),
			when: n.getProperty("when"),
			says: n.children?.findNodesByName("say").map((n) => ({
				line: n.getProperty("line"),
				voice: n.getProperty("voice"),
				image: n.getProperty("image"),
			})),
		})),
	};
}

export const Metric = z.object({
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
export type Metric = z.infer<typeof Metric>;

function readMetric(doc: Document) {
	const p = doc.findNodeByName("prometheus");
	const s = doc.findNodeByName("server");
	return {
		prometheus: {
			url: p?.getProperty("url"),
			interval: p?.getProperty("interval"),
		},
		server: {
			port: s?.getProperty("port"),
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
	load(path, readCharacter, CharacterSchema);
export const loadMetric = (path: string) => load(path, readMetric, Metric);
