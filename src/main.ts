import { loadCharacter, loadMetric } from "./config.ts";
import { query } from "./prometheus.ts";

const charConf = loadCharacter("./static/kiritan/character.kdl");
const metricConf = loadMetric("./static/metric.kdl");

const levelState = new Map<string, string>();
const eventState = new Map<string, number>();

type Message = {
	part: string;
	text: string;
	time: number;
};

let currentVoice: string | undefined;

const messageListeners = new Set<(message: Message) => void>();

function publish(part: string, text: string, voice: string | undefined) {
	currentVoice = voice;
	const message: Message = { part, text, time: Date.now() };
	for (const listener of messageListeners) {
		listener(message);
	}
}

// valueからレベルを判定する
function levelForValue(value: number): string {
	let next = charConf.levels[0].name;
	for (const level of charConf.levels) {
		if (value >= level.enter) {
			next = level.name;
		}
	}
	return next;
}

// レベルの遷移状態を判定する
function getLevel(value: number, current: string): string {
	const cur = charConf.levels.find((level) => level.name === current);
	if (cur && cur.exit !== undefined && value >= cur.exit && value < cur.enter) {
		return current;
	}

	return levelForValue(value);
}

// レベルごとにボイスをランダム選択
function levelVoice(levelName: string): string | undefined {
	const level = charConf.levels.find((l) => l.name === levelName);
	if (!level || level.voices.length === 0) return undefined;
	return level.voices[Math.floor(Math.random() * level.voices.length)];
}

function say(part: string, from: string, to: string) {
	for (const event of charConf.events) {
		if (event.part !== part) continue;
		if (event.to !== to) continue;
		if (!event.from.includes("*") && !event.from.includes(from)) continue;

		// say行にボイスが設定されている場合はそのボイスを使う
		const line = event.says[Math.floor(Math.random() * event.says.length)];
		const voice = line.voice ?? levelVoice(to);
		return { part, text: line.text, voice };
	}
	return null;
}

function react(part: string, when: "rise" | "fall") {
	for (const reaction of charConf.reactions) {
		if (reaction.event !== part) continue;
		if (reaction.when !== when) continue;

		const line =
			reaction.says[Math.floor(Math.random() * reaction.says.length)];
		return { part, text: line.text, voice: line.voice };
	}
	return null;
}

function tickLevel(part: string, value: number) {
	// 現在のレベルがない場合は、vauleをそのまま評価
	const before = levelState.get(part);
	// レベルが存在している場合は遷移を評価する
	const after =
		before === undefined ? levelForValue(value) : getLevel(value, before);
	levelState.set(part, after);
	if (before === after) return;

	const from = before ?? after;
	const text = say(part, from, after);
	if (!text) return;
	publish(text.part, text.text, text.voice);
}

function tickEvent(part: string, value: number) {
	const before = eventState.get(part) ?? 0;
	eventState.set(part, value);
	if (before === value) return;

	// 値の上昇/下降の判定
	const when = value > before ? "rise" : "fall";
	const reaction = react(part, when);
	if (!reaction) return;

	publish(reaction.part, reaction.text, reaction.voice);
}

async function tick() {
	for (const signal of metricConf.signals) {
		const res = await query(signal.query, metricConf.prometheus.url);
		if (res.data.resultType !== "vector") continue;
		const sample = res.data.result[0]?.value;
		if (!sample) continue;
		const value = Number(sample[1]);

		if (charConf.eventParts.includes(signal.part)) {
			tickEvent(signal.part, value);
		} else {
			tickLevel(signal.part, value);
		}
	}
}

setInterval(async () => {
	try {
		await tick();
	} catch (e) {
		console.error(e);
	}
}, Number(metricConf.prometheus.interval));

function handleState(): Response {
	const levels: Record<string, string> = {};
	for (const [part, level] of levelState) {
		levels[part] = level;
	}
	const events: Record<string, number> = {};
	for (const [part, value] of eventState) {
		events[part] = value;
	}
	return Response.json({ levels, events });
}

function handleVoice(): Response {
	if (!currentVoice) return new Response("no voice", { status: 404 });
	try {
		const bytes = Deno.readFileSync(`./static/${currentVoice}`);
		return new Response(bytes, { headers: { "content-type": "audio/wav" } });
	} catch {
		return new Response("not found", { status: 404 });
	}
}

const textEncoder = new TextEncoder();

function handleMessages(): Response {
	let listener: (message: Message) => void;
	const stream = new ReadableStream({
		start(controller) {
			listener = (message) => {
				controller.enqueue(
					textEncoder.encode(`data: ${JSON.stringify(message)}\n`),
				);
			};
			messageListeners.add(listener);
		},
		cancel() {
			messageListeners.delete(listener);
		},
	});
	return new Response(stream, {
		headers: { "content-type": "text/event-stream" },
	});
}

Deno.serve({ port: metricConf.server.port }, (req) => {
	const url = new URL(req.url);
	if (url.pathname === "/state") return handleState();
	if (url.pathname === "/messages") return handleMessages();
	if (url.pathname === "/voice") return handleVoice();
	return new Response("not found", { status: 404 });
});
