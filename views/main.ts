import {
	drawPNG,
	getMeshPosition,
	lerpPose,
	type Pose,
	Rig,
	setupCanvas,
} from "@kokoro/rig";
import { extractDepth, injectDepthToPose, uvToDepth } from "@kokoro/rig/depth";
import gsap from "gsap";
import type * as PIXI from "pixi.js";
import { Viewport } from "pixi-viewport";
import { z } from "zod";

type Level = "ok" | "hard" | "critical";

type Tier = {
	breathAmount: number;
	breathDuration: number;
	lookAmount: number;
	lookDuration: number;
};

type AnimState = {
	depth: { lift: Pose; neutral: Pose; left: Pose; right: Pose };
	t: { breath: number; look: number };
};

const API_BASE = new URL("http://localhost:3000");

const LEVEL_ORDER: Level[] = ["ok", "hard", "critical"];

function isLevel(value: string): value is Level {
	return (LEVEL_ORDER as string[]).includes(value);
}

const IMAGE_FOR_LEVEL: Record<Level, string> = {
	ok: "./images/normal.png",
	hard: "./images/hard.png",
	critical: "./images/critical.png",
};

const DEPTH_IMAGE_FOR_LEVEL: Record<Level, string> = {
	ok: "./images/normal_depth.png",
	hard: "./images/hard_depth.png",
	critical: "./images/critical_depth.png",
};

const TIER: Record<Level, Tier> = {
	ok: {
		breathAmount: 8,
		breathDuration: 2.4,
		lookAmount: 12,
		lookDuration: 6,
	},
	hard: {
		breathAmount: 12,
		breathDuration: 3.6,
		lookAmount: 8,
		lookDuration: 10,
	},
	critical: {
		breathAmount: 16,
		breathDuration: 4.8,
		lookAmount: 4,
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
	voice: z.string().optional(),
	time: z.number(),
});
type Message = z.infer<typeof Message>;

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
	return (u: number, v: number) => {
		const { fromTop } = getMeshPosition(u, v);
		return { tx: 0, ty: -amount * Math.sin(fromTop * Math.PI) };
	};
}

function sidePose(amount: number): Pose {
	return () => ({ tx: amount, ty: 0 });
}

function createAnimState(
	tier: Tier,
	depthFunc: (u: number, v: number) => number,
): AnimState {
	const depth = injectDepthToPose(
		{
			lift: liftPose(tier.breathAmount * 2),
			neutral: NEUTRAL,
			left: sidePose(-tier.lookAmount),
			right: sidePose(tier.lookAmount),
		},
		depthFunc,
	);

	const breath = { amount: 0 };
	gsap.to(breath, {
		amount: 1,
		duration: tier.breathDuration / 2,
		ease: "sine.inOut",
		repeat: -1,
		yoyo: true,
	});

	const look = { amount: 0 };
	gsap.to(look, {
		amount: 1,
		duration: tier.lookDuration / 2,
		ease: "sine.inOut",
		repeat: -1,
		yoyo: true,
	});

	return {
		depth: {
			lift: depth.lift,
			neutral: depth.neutral,
			left: depth.left,
			right: depth.right,
		},
		t: {
			get breath() {
				return breath.amount;
			},
			get look() {
				return look.amount;
			},
		},
	};
}

async function loadCharacterImage(
	url: string,
	depthUrl: string,
	renderer: PIXI.Renderer,
) {
	const nodes = await drawPNG(url);
	const rig = new Rig(nodes);

	const depthNodes = await drawPNG(depthUrl);
	const { data, width, height } = extractDepth(
		depthNodes[0].container,
		renderer,
	);
	const depthFunc = uvToDepth(data, width, height);

	return { container: nodes[0].container, rig, depthFunc };
}

const voicePlayer = new Audio();

async function playVoice(voice: string) {
	try {
		const res = await fetch(new URL(`/static/${voice}`, API_BASE));
		if (!res.ok) return;
		const blob = await res.blob();
		voicePlayer.src = URL.createObjectURL(blob);
		await voicePlayer.play();
	} catch (e) {
		console.error(e);
	}
}

function listenMessages(onMessage: (message: Message) => void) {
	const source = new EventSource(new URL("/messages", API_BASE).toString());
	source.onmessage = (ev) => {
		onMessage(Message.parse(JSON.parse(ev.data)));
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

	const chatLog = document.getElementById("chat-log");
	if (!chatLog) return;

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
	const animations = new Map<Level, AnimState>();
	for (const level of LEVEL_ORDER) {
		const character = await loadCharacterImage(
			IMAGE_FOR_LEVEL[level],
			DEPTH_IMAGE_FOR_LEVEL[level],
			app.renderer,
		);
		character.container.visible = false;
		viewport.addChild(character.container);
		characters.set(level, character);
		animations.set(level, createAnimState(TIER[level], character.depthFunc));
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
		const anim = animations.get(currentLevel);
		if (!character || !anim) return;

		character.rig.apply([
			lerpPose(anim.depth.neutral, anim.depth.lift, anim.t.breath),
			lerpPose(anim.depth.left, anim.depth.right, anim.t.look),
		]);
	});

	pollState(setLevel);
	listenMessages((message) => {
		appendChatMessage(chatLog, message);
		if (message.voice) playVoice(message.voice);
	});
}

main();
