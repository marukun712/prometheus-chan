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
import * as PIXI from "pixi.js";
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

type Bubble = {
	container: PIXI.Container;
	background: PIXI.Graphics;
	text: PIXI.Text;
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

function createBubble(): Bubble {
	const text = new PIXI.Text({
		text: "",
		style: {
			fontSize: 80,
			fill: 0x000000,
			wordWrap: true,
			wordWrapWidth: 800,
			align: "center",
		},
	});
	text.anchor.set(0.5);

	const background = new PIXI.Graphics();

	const container = new PIXI.Container();
	container.addChild(background);
	container.addChild(text);
	container.visible = false;

	return { container, background, text };
}

function setBubbleText(bubble: Bubble, value: string) {
	bubble.text.text = value;

	const width = bubble.text.width + 24;
	const height = bubble.text.height + 24;
	bubble.background
		.clear()
		.roundRect(0, 0, width, height, 16)
		.fill(0xffffff)
		.stroke({ width: 6, color: 0x00000 });

	bubble.text.x = width / 2;
	bubble.text.y = height / 2;
}

function positionBubble(
	bubble: Bubble,
	character: { container: PIXI.Container; rig: Rig },
) {
	bubble.container.x =
		character.container.x + character.rig.minX + character.rig.w;
	bubble.container.y =
		character.container.y + character.rig.minY - bubble.container.height;
}

let bubbleHideTimer: ReturnType<typeof setTimeout> | undefined;

function showBubble(bubble: Bubble, text: string) {
	setBubbleText(bubble, text);
	bubble.container.visible = true;

	clearTimeout(bubbleHideTimer);
	bubbleHideTimer = setTimeout(() => {
		bubble.container.visible = false;
	}, 24000);
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

	const bubble = createBubble();
	viewport.addChild(bubble.container);
	showBubble(bubble, "お疲れ様です！");

	app.ticker.add(() => {
		const character = characters.get(currentLevel);
		const anim = animations.get(currentLevel);
		if (!character || !anim) return;

		character.rig.apply([
			lerpPose(anim.depth.neutral, anim.depth.lift, anim.t.breath),
			lerpPose(anim.depth.left, anim.depth.right, anim.t.look),
		]);

		positionBubble(bubble, character);
	});

	pollState(setLevel);
	listenMessages((text) => {
		showBubble(bubble, text);
		playVoice();
	});
}

main();
