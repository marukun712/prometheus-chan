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

const Message = z.object({
	part: z.string(),
	text: z.string(),
	voice: z.string().optional(),
	image: z.string().optional(),
	level: z.string().optional(),
	time: z.number(),
});
type Message = z.infer<typeof Message>;

const State = z.object({
	levels: z.array(
		z.object({
			name: z.string(),
			label: z.string(),
			color: z.string(),
		}),
	),
	parts: z.array(
		z.object({
			id: z.string(),
			label: z.string(),
		}),
	),
	levelState: z.record(z.string(), z.string()),
	eventState: z.record(z.string(), z.number()),
});
type State = z.infer<typeof State>;

const animConf = {
	breathAmount: 8 * 3,
	breathDuration: 2.4,
	lookAmount: 12 * 5,
	lookDuration: 6,
};

const levels = ["ok", "hard", "critical"];

function depthPath(image: string) {
	const dot = image.lastIndexOf(".");
	return `${image.slice(0, dot)}_depth${image.slice(dot)}`;
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

function createTemplate(
	level: number,
	depthFunc: (u: number, v: number) => number,
) {
	const depth = injectDepthToPose(
		{
			lift: liftPose(animConf.breathAmount * level),
			neutral: NEUTRAL,
			left: sidePose(-animConf.lookAmount / level),
			right: sidePose(animConf.lookAmount / level),
		},
		depthFunc,
	);

	const breath = { amount: 0 };
	gsap.to(breath, {
		amount: 1,
		duration: (animConf.breathDuration / 2) * level,
		ease: "sine.inOut",
		repeat: -1,
		yoyo: true,
	});

	const look = { amount: 0 };
	gsap.to(look, {
		amount: 1,
		duration: animConf.lookDuration / 2 / level,
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
		const res = await fetch(`/static/${voice}`);
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

async function fetchState(): Promise<State | null> {
	try {
		const res = await fetch("/state");
		if (!res.ok) return null;
		return State.parse(await res.json());
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
	let level: number = 1;
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
	if (initialState) renderState(stateView, initialState);

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

	const path = `/static/images/default.png`;
	const result = await loadCharacterImage(path, depthPath(path), app.renderer);
	let container = result.container;
	let rig = result.rig;
	let template = createTemplate(level, result.depthFunc);
	viewport.addChild(container);

	app.ticker.add(() => {
		rig.apply([
			lerpPose(template.depth.neutral, template.depth.lift, template.t.breath),
			lerpPose(template.depth.left, template.depth.right, template.t.look),
		]);
	});

	listenMessages(async (message) => {
		appendChatMessage(chatLog, message);

		const state = await fetchState();
		if (state) renderState(stateView, state);

		if (message.voice) playVoice(message.voice);
		if (message.level) {
			level = levels.indexOf(message.level) + 1;
		}
		if (message.image) {
			const path = `/static/${message.image}`;
			const result = await loadCharacterImage(
				path,
				depthPath(path),
				app.renderer,
			);
			viewport.removeChildren();
			container = result.container;
			rig = result.rig;
			template = createTemplate(level, result.depthFunc);
			viewport.addChild(container);
		}
	});
}

main();
