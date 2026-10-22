import {
	type Animation,
	curve,
	drawPNG,
	getMeshPosition,
	loop,
	type Pose,
	Rig,
	seq,
	setupCanvas,
} from "@kokoro/rig";
import { Viewport } from "pixi-viewport";
import { z } from "zod";

const API_BASE = new URL("http://localhost:3000");

type Level = "ok" | "hard" | "critical";

const LEVEL_ORDER: Level[] = ["ok", "hard", "critical"];

function isLevel(value: string): value is Level {
	return (LEVEL_ORDER as string[]).includes(value);
}

const IMAGE_FOR_LEVEL: Record<Level, string> = {
	ok: "./images/normal.png",
	hard: "./images/hard.png",
	critical: "./images/critical.png",
};

type Tier = {
	breathAmount: number;
	breathDuration: number;
	lookAmount: number;
	lookDuration: number;
};

const TIER: Record<Level, Tier> = {
	ok: {
		breathAmount: 6,
		breathDuration: 2.4,
		lookAmount: 0.05,
		lookDuration: 6,
	},
	hard: {
		breathAmount: 10,
		breathDuration: 3.6,
		lookAmount: 0.025,
		lookDuration: 10,
	},
	critical: {
		breathAmount: 14,
		breathDuration: 5,
		lookAmount: 0.01,
		lookDuration: 16,
	},
};

const State = z.object({
	levels: z.record(z.string(), z.string()),
	events: z.record(z.string(), z.number()),
});

const Message = z.object({
	part: z.string(),
	text: z.string(),
	time: z.number(),
});

// 一番状態が悪いパーツのレベルを取得する
function worstLevel(levels: Record<string, string>): Level {
	let worst: Level = "ok";
	for (const value of Object.values(levels)) {
		if (!isLevel(value)) continue;
		if (LEVEL_ORDER.indexOf(value) > LEVEL_ORDER.indexOf(worst)) worst = value;
	}
	return worst;
}

const NEUTRAL: Pose = () => ({ tx: 0, ty: 0 });

function liftPose(amount: number): Pose {
	return (u, v) => {
		const { fromTop } = getMeshPosition(u, v);
		return { tx: 0, ty: -amount * curve.power2(fromTop) };
	};
}

function breathAnimation(tier: Tier): Animation {
	const half = tier.breathDuration / 2;
	return loop(
		seq([
			{ duration: half, pose: liftPose(tier.breathAmount), ease: curve.power2 },
			{ duration: half, pose: NEUTRAL, ease: curve.power2 },
		]),
		tier.breathDuration,
	);
}

function lookAroundPose(t: number, tier: Tier): Pose {
	const angle =
		Math.sin((2 * Math.PI * t) / tier.lookDuration) * tier.lookAmount;
	return () => ({ tx: 0, ty: 0, rot: angle, pivot: { u: 0.5, v: 1.0 } });
}

async function loadCharacterImage(url: string) {
	const nodes = await drawPNG(url);
	const rig = new Rig(nodes);
	return { container: nodes[0].container, rig };
}

let bubbleHideTimer: ReturnType<typeof setTimeout> | undefined;

function showBubble(text: string) {
	const bubble = document.getElementById("bubble");
	const bubbleText = document.getElementById("bubble-text");
	if (!bubble || !bubbleText) return;

	bubbleText.textContent = text;
	bubble.hidden = false;

	clearTimeout(bubbleHideTimer);
	bubbleHideTimer = setTimeout(() => {
		bubble.hidden = true;
	}, 6000);
}

const voicePlayer = new Audio();

async function playVoice() {
	try {
		const voiceUrl = new URL("/voice", API_BASE);
		voiceUrl.searchParams.set("t", String(Date.now()));
		const res = await fetch(voiceUrl);
		if (!res.ok) return;
		const blob = await res.blob();
		voicePlayer.src = URL.createObjectURL(blob);
		await voicePlayer.play();
	} catch (e) {
		console.error(e);
	}
}

function listenMessages(onMessage: (text: string) => void) {
	const source = new EventSource(new URL("/messages", API_BASE).toString());
	source.onmessage = (ev) => {
		const message = Message.parse(JSON.parse(ev.data));
		onMessage(message.text);
	};
}

function pollState(onLevel: (level: Level) => void) {
	async function tick() {
		try {
			const res = await fetch(new URL("/state", API_BASE));
			if (res.ok) {
				const state = State.parse(await res.json());
				onLevel(worstLevel(state.levels));
			}
		} catch (e) {
			console.error(e);
		}
		setTimeout(tick, 3000);
	}
	tick();
}

async function main() {
	const stage = document.getElementById("stage");
	if (!stage) return;

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

	const characters = new Map<
		Level,
		Awaited<ReturnType<typeof loadCharacterImage>>
	>();
	for (const level of LEVEL_ORDER) {
		const character = await loadCharacterImage(IMAGE_FOR_LEVEL[level]);
		character.container.visible = false;
		viewport.addChild(character.container);
		characters.set(level, character);
	}

	let currentLevel: Level = LEVEL_ORDER[0];
	const first = characters.get(currentLevel);
	if (first) first.container.visible = true;

	function setLevel(level: Level) {
		if (level === currentLevel) return;
		const prev = characters.get(currentLevel);
		if (prev) prev.container.visible = false;
		const next = characters.get(level);
		if (next) next.container.visible = true;
		currentLevel = level;
	}

	app.ticker.add(() => {
		const character = characters.get(currentLevel);
		if (!character) return;

		const t = app.ticker.lastTime / 1000;
		const tier = TIER[currentLevel];
		character.rig.apply([...breathAnimation(tier)(t), lookAroundPose(t, tier)]);
	});

	pollState(setLevel);
	listenMessages((text) => {
		showBubble(text);
		playVoice();
	});
}

main();
