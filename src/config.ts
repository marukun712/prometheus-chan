import type { Document, Node } from "@bgotink/kdl";
import { parseCompat } from "@bgotink/kdl/v1-compat";
import { z } from "zod";

const arg = (n: Node | undefined, i = 0) => n?.getArgument(i);
const childArg = (n: Node | undefined, name: string) =>
	arg(n?.children?.findNodeByName(name));

const SaysSchema = z.array(
	z.object({
		line: z.string(),
		voice: z.string(),
		image: z.string(),
	}),
);

const DEFAULT_IMAGE = "images/default.png";

const readSays = (n: Node | undefined) =>
	n?.children?.findNodesByName("say").map((s) => ({
		line: s.getProperty("line"),
		voice: s.getProperty("voice"),
		image: s.getProperty("image") ?? DEFAULT_IMAGE,
	}));

const LevelListSchema = z.string().transform((s) => s.split(","));

export const PackSchema = z.object({
	id: z.string(),
	name: z.string(),
	levels: z.array(
		z.object({
			name: z.string(),
			label: z.string(),
			color: z.string(),
			enter: z.number(),
			exit: z.number().optional(),
		}),
	),
});
export type Pack = z.infer<typeof PackSchema>;

function readPack(doc: Document) {
	const character = doc.findNodeByName("character");
	return {
		id: arg(character),
		name: childArg(character, "name"),
		levels: doc.findNodeByName("levels")?.children?.nodes.map((n) => ({
			name: n.getName(),
			label: childArg(n, "label"),
			color: childArg(n, "color"),
			enter: n.getProperty("enter"),
			exit: n.getProperty("exit"),
		})),
	};
}

export const ProfileSchema = z.object({
	parts: z.array(
		z.object({
			id: z.string(),
			label: z.string(),
			on: z.array(
				z.object({
					from: LevelListSchema,
					to: z.string(),
					says: SaysSchema,
				}),
			),
			ask: z.array(
				z.object({
					level: LevelListSchema,
					says: SaysSchema,
				}),
			),
			care: z.array(
				z.object({
					level: LevelListSchema,
					line: z.string(),
				}),
			),
		}),
	),
});
export type Profile = z.infer<typeof ProfileSchema>;

function readProfile(doc: Document) {
	return {
		parts: doc.findNodesByName("part").map((n) => ({
			id: arg(n, 0),
			label: arg(n, 1),
			on:
				n.children?.findNodesByName("on").map((c) => ({
					from: c.getProperty("from"),
					to: c.getProperty("to"),
					says: readSays(c),
				})) ?? [],
			ask:
				n.children?.findNodesByName("ask").map((c) => ({
					level: c.getProperty("level"),
					says: readSays(c),
				})) ?? [],
			care:
				n.children?.findNodesByName("care").map((c) => ({
					level: c.getProperty("level"),
					line: c.getProperty("line"),
				})) ?? [],
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
		signals: doc.findNodesByName("query").map((n) => ({
			part: arg(n, 0),
			query: arg(n, 1),
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

export const loadPack = (path: string) => load(path, readPack, PackSchema);
export const loadProfile = (path: string) =>
	load(path, readProfile, ProfileSchema);
export const loadMetric = (path: string) => load(path, readMetric, Metric);
