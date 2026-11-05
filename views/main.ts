import type { Animation } from "@kokoro/rig";
import {
	type LevelState,
	type Message,
	MessageSchema,
	type Pack,
	type Profile,
	type State,
	StateSchema,
} from "../src/schema.ts";
import {
	applyAnim,
	loadCharacter,
	makeAnims,
	makeApplyFace,
	makeBodyRig,
	makeGroupRigs,
	seqDuration,
	setupStage,
} from "./character.ts";
import {
	careLines,
	currentLevel,
	emptyInputs,
	fetchPack,
	resolveMoves,
} from "./pack.ts";
import { makeTemplate } from "./template.ts";

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
	onState: (state: State) => void,
) {
	const source = new EventSource("/messages");
	source.onmessage = (ev) => {
		onMessage(MessageSchema.parse(JSON.parse(ev.data)));
	};
	source.addEventListener("state", (ev: MessageEvent) => {
		onState(StateSchema.parse(JSON.parse(ev.data)));
	});
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

function renderState(
	view: HTMLElement,
	pack: Pack,
	profile: Profile,
	levelState: LevelState,
) {
	view.replaceChildren();
	for (const part of profile.parts) {
		const levelName = levelState[part.id];
		if (!levelName) continue;

		const level = pack.levels.find((l) => l.name === levelName);
		if (!level) continue;

		const item = document.createElement("span");
		item.textContent = `${part.label}\n${level.label}`;
		item.style.color = level.color;
		view.appendChild(item);
	}
}

function renderCare(
	view: HTMLElement,
	profile: Profile,
	levelState: LevelState,
) {
	view.replaceChildren();
	const lines = careLines(profile, levelState);

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

	const loaded = await fetchPack();
	if (!loaded) return;
	const { pack, profile } = loaded;

	let state: State = { inputs: emptyInputs(profile), levelState: {} };
	let moves = resolveMoves(pack, state.inputs);

	careButton.addEventListener("click", () => {
		careView.hidden = !careView.hidden;
		if (!careView.hidden) renderCare(careView, profile, state.levelState);
	});

	const { app, viewport } = await setupStage(stage);

	const character = await loadCharacter(`/pack/${pack.psd}`);
	viewport.addChild(character.container);

	const bodyRig = makeBodyRig(character.nodes, pack.groups);
	const groupRigs = makeGroupRigs(character.nodes, pack.groups);

	const template = makeTemplate(bodyRig);
	const applyFace = makeApplyFace(character.nodes, pack.faces);

	let currentAnim = new Map<string, Animation>();
	let playing: string | undefined;
	let time = 0;
	let backToLevel: ReturnType<typeof setTimeout> | undefined;

	const levelFace = () => currentLevel(pack, profile, state.levelState)?.face;

	const play = (name?: string) => {
		const target = name ?? currentLevel(pack, profile, state.levelState)?.move;
		const move = moves.find((m) => m.name === target);
		if (!move) return undefined;

		playing = move.name;
		currentAnim = makeAnims(move, template);
		time = 0;
		applyFace(move.face ?? levelFace());
		return move;
	};

	for (const node of character.nodes) {
		node.sprite.eventMode = "static";
		node.sprite.on("pointertap", () => {
			const level = currentLevel(pack, profile, state.levelState);
			if (level) playVoice(level.voice);
		});
	}

	app.ticker.add((ticker) => {
		time += ticker.deltaMS / 1000;
		applyAnim(currentAnim, time, bodyRig, groupRigs);
	});

	const refresh = (next: State) => {
		state = next;
		moves = resolveMoves(pack, state.inputs);
		renderState(stateView, pack, profile, state.levelState);

		if (playing === undefined) {
			play();
			return;
		}

		const move = moves.find((m) => m.name === playing);
		if (!move) return;
		currentAnim = makeAnims(move, template);
		applyFace(move.face ?? levelFace());
	};

	listenMessages((message) => {
		appendChatMessage(chatLog, message);

		if (message.voice) playVoice(message.voice);

		const move = play(message.move);
		if (!move) return;

		clearTimeout(backToLevel);
		if (move.loop) return;

		let longest = 0;
		for (const group of move.groups) {
			longest = Math.max(longest, seqDuration(group.seq));
		}

		backToLevel = setTimeout(() => {
			play();
		}, longest * 1000);
	}, refresh);
}

main();
