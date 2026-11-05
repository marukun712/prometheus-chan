import type { Animation } from "@kokoro/rig";
import { z } from "zod";
import { type Message, MessageSchema, type State } from "../src/schema.ts";
import {
	applyAnim,
	fetchState,
	loadCharacter,
	makeAnims,
	makeApplyFace,
	makeBodyRig,
	makeGroupRigs,
	seqDuration,
	setupStage,
} from "./character.ts";
import { makeTemplate } from "./template.ts";

function currentLevel(state: State) {
	const current = state.parts.map((part) => state.levelState[part.id]);
	return state.levels.filter((level) => current.includes(level.name)).at(-1);
}

function findMove(state: State, name?: string) {
	const target = name ?? currentLevel(state)?.move;
	return state.moves.find((move) => move.name === target);
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

function listenMessages(
	onMessage: (message: Message) => void,
	onValues: () => void,
) {
	const source = new EventSource("/messages");
	source.onmessage = (ev) => {
		onMessage(MessageSchema.parse(JSON.parse(ev.data)));
	};
	source.addEventListener("values", () => onValues());
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

function renderState(view: HTMLElement, state: State) {
	view.replaceChildren();
	for (const part of state.parts) {
		const levelName = state.levelState[part.id];
		if (!levelName) continue;

		const level = state.levels.find((l) => l.name === levelName);
		if (!level) continue;

		const item = document.createElement("span");
		item.textContent = `${part.label}\n${level.label}`;
		item.style.color = level.color;
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

	let state = initialState;
	renderState(stateView, state);

	const { app, viewport } = await setupStage(stage);

	const character = await loadCharacter(`/pack/${state.psd}`);
	viewport.addChild(character.container);

	const bodyRig = makeBodyRig(character.nodes, state.groups);
	const groupRigs = makeGroupRigs(character.nodes, state.groups);

	const template = makeTemplate(bodyRig);
	const applyFace = makeApplyFace(character.nodes, state.faces);

	let currentAnim = new Map<string, Animation>();
	let playing: string | undefined;
	let time = 0;
	let backToLevel: ReturnType<typeof setTimeout> | undefined;

	const play = (state: State, name?: string) => {
		const move = findMove(state, name);
		if (!move) return undefined;

		playing = move.name;
		currentAnim = makeAnims(move, template);
		time = 0;
		applyFace(move.face ?? currentLevel(state)?.face);
		return move;
	};

	play(state);

	for (const node of character.nodes) {
		node.sprite.eventMode = "static";
		node.sprite.on("pointertap", () => {
			const level = currentLevel(state);
			if (level) playVoice(level.voice);
		});
	}

	app.ticker.add((ticker) => {
		time += ticker.deltaMS / 1000;
		applyAnim(currentAnim, time, bodyRig, groupRigs);
	});

	const refresh = async () => {
		const next = await fetchState();
		if (!next) return;
		state = next;
		renderState(stateView, state);

		const move = findMove(state, playing);
		if (!move) return;
		currentAnim = makeAnims(move, template);
		applyFace(move.face ?? currentLevel(state)?.face);
	};

	listenMessages(async (message) => {
		appendChatMessage(chatLog, message);

		const next = await fetchState();
		if (!next) return;
		state = next;
		renderState(stateView, state);

		if (message.voice) playVoice(message.voice);

		const move = play(state, message.move);
		if (!move) return;

		clearTimeout(backToLevel);
		if (move.loop) return;

		let longest = 0;
		for (const group of move.groups) {
			longest = Math.max(longest, seqDuration(group.seq));
		}

		backToLevel = setTimeout(() => {
			play(state);
		}, longest * 1000);
	}, refresh);
}

main();
