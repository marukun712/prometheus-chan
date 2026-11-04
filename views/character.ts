import {
	type Animation,
	byName,
	drawPSD,
	groupNodes,
	loop,
	or,
	type Pose,
	Rig,
	resolveSeqExpr,
	type SpriteNode,
	Switcher,
	setupCanvas,
	walkPSD,
	withParent,
} from "@kokoro/rig";
import { Container } from "pixi.js";
import { Viewport } from "pixi-viewport";
import {
	type Group as GroupConf,
	type Move,
	type State,
	StateSchema,
} from "../src/schema.ts";

const meshVertices = 50;
const bodyGroup = "body";

export async function fetchState(): Promise<State | null> {
	try {
		const res = await fetch("/state");
		if (!res.ok) return null;
		return StateSchema.parse(await res.json());
	} catch (e) {
		console.error(e);
		return null;
	}
}

export async function setupStage(stage: HTMLElement) {
	const app = await setupCanvas(stage);

	const viewport = new Viewport({
		screenWidth: globalThis.innerWidth,
		screenHeight: globalThis.innerHeight,
		worldWidth: 1000,
		worldHeight: 1000,
		events: app.renderer.events,
	});

	app.stage.addChild(viewport);
	viewport.drag().pinch().wheel();

	return { app, viewport };
}

export async function loadCharacter(url: string) {
	const layers = await walkPSD(url);
	const nodes = drawPSD(layers, meshVertices, meshVertices);

	const container = new Container();
	for (const node of nodes) container.addChild(node.container);

	return { container, nodes };
}

export function makeBodyRig(nodes: SpriteNode[], groups: GroupConf[]) {
	const grouped = new Set(groups.flatMap((group) => group.layers));
	return new Rig(nodes.filter((node) => !grouped.has(node.name)));
}

export function makeGroupRigs(nodes: SpriteNode[], groups: GroupConf[]) {
	const rigs = new Map<string, Rig>();
	for (const group of groups) {
		const matched = groupNodes(nodes, or(...group.layers.map(byName)));
		if (matched.nodes.length > 0) rigs.set(group.name, new Rig(matched.nodes));
	}
	return rigs;
}

export function makeApplyFace(nodes: SpriteNode[], faces: string[]) {
	const switcher = new Switcher(nodes, faces);

	return (name: string | undefined) => {
		if (!name) return;
		switcher.apply(
			Object.fromEntries(faces.map((face) => [face, face === name])),
		);
	};
}

export function makeAnims(move: Move, template: Record<string, Pose>) {
	return new Map(
		move.groups.map((group): [string, Animation] => {
			const anim = resolveSeqExpr(template, group.seq);
			if (!move.loop) return [group.name, anim];

			return [group.name, loop(anim, seqDuration(group.seq))];
		}),
	);
}

export function seqDuration(seq: Move["groups"][number]["seq"]) {
	let duration = 0;
	for (const clip of seq) {
		duration += clip.duration;
	}
	return duration;
}

export function applyAnim(
	anims: Map<string, Animation>,
	time: number,
	bodyRig: Rig,
	groupRigs: Map<string, Rig>,
) {
	const base = anims.get(bodyGroup)?.(time) ?? [];
	bodyRig.apply(base);

	const applyWithBody = withParent(bodyRig, base);

	for (const [name, rig] of groupRigs) {
		const anim = anims.get(name);
		applyWithBody(rig, anim ? anim(time) : []);
	}
}
