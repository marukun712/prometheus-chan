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
	setupCanvas,
	walkPSD,
	withParent,
} from "@kokoro/rig";
import { Container } from "pixi.js";
import { Viewport } from "pixi-viewport";
import { z } from "zod";
import {
	type Group as GroupConf,
	type Message,
	MessageSchema,
	type Move as MoveConf,
	type State,
	StateSchema,
} from "../src/schema.ts";
import { HAIR_TEMPLATE, POSE_TEMPLATE } from "./template.ts";

const meshVertices = 100;

// KDLのposeはこのテンプレートを名前で参照する
const poseTemplate: Record<string, Pose> = {
	...POSE_TEMPLATE(),
	...HAIR_TEMPLATE,
};

// グループ宣言に出てこないレイヤーをまとめたものがbody
const bodyGroup = "body";

function makeAnims(move: MoveConf): Map<string, Animation> {
	return new Map(
		move.groups.map((group) => [
			group.name,
			loop(
				resolveSeqExpr(poseTemplate, group.seq),
				group.seq.reduce((sum, clip) => sum + clip.duration, 0),
			),
		]),
	);
}

function makeBodyRig(nodes: SpriteNode[], groups: GroupConf[]): Rig {
	const grouped = new Set(groups.flatMap((group) => group.layers));
	return new Rig(nodes.filter((node) => !grouped.has(node.name)));
}

function makeGroupRigs(
	nodes: SpriteNode[],
	groups: GroupConf[],
): Map<string, Rig> {
	const rigs = new Map<string, Rig>();
	for (const group of groups) {
		const matched = groupNodes(nodes, or(...group.layers.map(byName)));
		if (matched.nodes.length > 0) rigs.set(group.name, new Rig(matched.nodes));
	}
	return rigs;
}

function levelMove(state: State): string | undefined {
	const current = state.parts.map((part) => state.levelState[part.id]);
	return state.levels.filter((level) => current.includes(level.name)).at(-1)
		?.move;
}

async function loadCharacter(url: string) {
	const layers = await walkPSD(url);
	const nodes = drawPSD(layers, meshVertices, meshVertices);

	const container = new Container();
	for (const node of nodes) container.addChild(node.container);

	return { container, nodes };
}

const voicePlayer = new Audio();

async function playVoice(voice: string) {
	try {
		const res = await fetch(`/pack/${voice}`);
		if (!res.ok) return;
		const blob = await res.blob();
		voicePlayer.src = URL.createObjectURL(blob);
		await voicePlayer.play();
	} catch (e) {
		console.error(e);
	}
}

function listenMessages(onMessage: (message: Message) => void) {
	const source = new EventSource("/messages");
	source.onmessage = (ev) => {
		onMessage(MessageSchema.parse(JSON.parse(ev.data)));
	};
}

function appendChatMessage(log: HTMLElement, message: Message) {
	const item = document.createElement("li");
	item.textContent = message.text;

	const time = document.createElement("time");
	time.textContent = new Date(message.time).toLocaleTimeString("ja-JP", {
		hour: "2-digit",
		minute: "2-digit",
	});
	item.appendChild(time);

	log.appendChild(item);
	log.scrollTop = log.scrollHeight;
}

async function fetchState(): Promise<State | null> {
	try {
		const res = await fetch("/state");
		if (!res.ok) return null;
		return StateSchema.parse(await res.json());
	} catch (e) {
		console.error(e);
		return null;
	}
}

function renderState(view: HTMLElement, state: State) {
	view.replaceChildren();
	for (const part of state.parts) {
		const levelName = state.levelState[part.id];
		if (!levelName) continue;

		const level = state.levels.find((l) => l.name === levelName);
		if (!level) continue;

		const item = document.createElement("button");
		item.type = "button";
		item.textContent = `${part.label}\n${level.label}`;
		item.style.color = level.color;
		item.addEventListener("click", () => {
			fetch(`/ask?part=${encodeURIComponent(part.id)}`);
		});
		view.appendChild(item);
	}
}

async function renderCare(view: HTMLElement) {
	view.replaceChildren();
	try {
		const res = await fetch("/care");
		if (!res.ok) return;
		const lines = z.array(z.string()).parse(await res.json());

		if (lines.length === 0) {
			const item = document.createElement("li");
			item.textContent = "特にないよ";
			view.appendChild(item);
			return;
		}

		for (const line of lines) {
			const item = document.createElement("li");
			item.textContent = line;
			view.appendChild(item);
		}
	} catch (e) {
		console.error(e);
	}
}

async function main() {
	const stage = document.getElementById("stage");
	if (!stage) return;

	const chatLog = document.getElementById("chat-log");
	if (!chatLog) return;

	const stateView = document.getElementById("state");
	if (!stateView) return;

	const careView = document.getElementById("care");
	if (!careView) return;

	const careButton = document.getElementById("care-toggle");
	if (!careButton) return;

	careButton.addEventListener("click", async () => {
		careView.hidden = !careView.hidden;
		if (!careView.hidden) await renderCare(careView);
	});

	const initialState = await fetchState();
	if (!initialState) return;
	renderState(stateView, initialState);

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

	const character = await loadCharacter(`/pack/${initialState.psd}`);
	viewport.addChild(character.container);

	const bodyRig = makeBodyRig(character.nodes, initialState.groups);
	const groupRigs = makeGroupRigs(character.nodes, initialState.groups);

	let anims = new Map<string, Animation>();
	let startedAt = 0;

	const play = (state: State, name: string | undefined) => {
		const move = state.moves.find((move) => move.name === name);
		if (!move) return;

		anims = makeAnims(move);
		startedAt = performance.now() / 1000;
	};

	play(initialState, levelMove(initialState));

	app.ticker.add(() => {
		const t = performance.now() / 1000 - startedAt;
		const posesOf = (group: string) => anims.get(group)?.(t) ?? [];

		const bodyPoses = posesOf(bodyGroup);
		bodyRig.apply(bodyPoses);

		const applyWithBody = withParent(bodyRig, bodyPoses);
		for (const [name, rig] of groupRigs) {
			applyWithBody(rig, posesOf(name));
		}
	});

	listenMessages(async (message) => {
		appendChatMessage(chatLog, message);

		const state = await fetchState();
		if (state) {
			renderState(stateView, state);
			play(state, message.move ?? levelMove(state));
		}

		if (message.voice) playVoice(message.voice);
	});
}

main();
