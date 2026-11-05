import type { Document, Node } from "@bgotink/kdl";
import { parseCompat } from "@bgotink/kdl/v1-compat";
import type { z } from "zod";
import { MetricSchema, PackSchema, ProfileSchema } from "./schema.ts";

const arg = (n: Node | undefined, i = 0) => n?.getArgument(i);
const childArg = (n: Node | undefined, name: string) =>
	arg(n?.children?.findNodeByName(name));

const readSeq = (n: Node | undefined) =>
	n?.children?.findNodesByName("pose").map((p) => {
		const lerp = p.getProperty("lerp");
		return {
			pose:
				lerp === undefined
					? arg(p)
					: { lerp: String(lerp).split(","), t: p.getProperty("t") },
			duration: p.getProperty("duration"),
			ease: p.getProperty("ease"),
		};
	}) ?? [];

const readSays = (n: Node | undefined) =>
	n?.children?.findNodesByName("say").map((s) => ({
		line: s.getProperty("line"),
		voice: s.getProperty("voice"),
		move: s.getProperty("move"),
	}));

function readPack(doc: Document) {
	const character = doc.findNodeByName("character");
	return {
		id: arg(character),
		name: childArg(character, "name"),
		psd: childArg(character, "psd"),
		faces: doc.findNodeByName("face")?.getArguments() ?? [],
		groups: doc.findNodesByName("group").map((n) => ({
			name: arg(n),
			layers: n.children?.findNodeByName("layer")?.getArguments() ?? [],
		})),
		moves: doc.findNodesByName("move").map((n) => ({
			name: arg(n),
			loop: n.getProperty("loop"),
			face: n.getProperty("face"),
			groups:
				n.children?.findNodesByName("group").map((l) => ({
					name: arg(l),
					seq: readSeq(l),
				})) ?? [],
		})),
		levels: doc.findNodeByName("levels")?.children?.nodes.map((n) => ({
			name: n.getName(),
			label: childArg(n, "label"),
			color: childArg(n, "color"),
			face: childArg(n, "face"),
			move: childArg(n, "move"),
			voice: childArg(n, "voice"),
			enter: n.getProperty("enter"),
			exit: n.getProperty("exit"),
		})),
	};
}

function readProfile(doc: Document) {
	return {
		inputs: doc.findNodesByName("input").map((n) => ({
			name: arg(n),
			part: n.getProperty("part"),
		})),
		parts: doc.findNodesByName("part").map((n) => ({
			id: arg(n, 0),
			label: arg(n, 1),
			on:
				n.children?.findNodesByName("on").map((c) => ({
					from: c.getProperty("from"),
					to: c.getProperty("to"),
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
export const loadMetric = (path: string) =>
	load(path, readMetric, MetricSchema);
