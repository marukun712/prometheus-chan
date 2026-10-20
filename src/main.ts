import { loadCharacter, loadMetric } from "./config.ts";
import { query } from "./prometheus.ts";

const charConf = loadCharacter("./static/example-chan/character.kdl");
const metricConf = loadMetric("./static/metric.kdl");

const levelState = new Map<string, string>();
const eventState = new Map<string, number>();

type Message = {
	part: string;
	text: string;
	voice: string;
	time: number;
};

const messageListeners = new Set<(message: Message) => void>();

function publish(part: string, text: string, voice: string) {
	const message: Message = { part, text, voice, time: Date.now() };
	for (const listener of messageListeners) {
		listener(message);
	}
}

function getLevel(value: number, current: string): string {
	let next = "ok";
	for (const level of charConf.levels) {
		if (value >= level.enter) {
			next = level.name;
		}
	}

	const cur = charConf.levels.find((level) => level.name === current);
	if (cur && cur.exit !== undefined && value >= cur.exit && value < cur.enter) {
		return current;
	}

	return next;
}

function say(part: string, from: string, to: string) {
	for (const event of charConf.events) {
		if (event.part !== part) continue;
		if (event.to !== to) continue;
		if (!event.from.includes("*") && !event.from.includes(from)) continue;

		const line = event.says[Math.floor(Math.random() * event.says.length)];
		return { part, text: line.text, voice: line.voice };
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
	const before = levelState.get(part) ?? "ok";
	const after = getLevel(value, before);
	levelState.set(part, after);

	const text = say(part, before, after);
	if (!text) return;
	publish(text.part, text.text, text.voice);
}

function tickEvent(part: string, value: number) {
	const before = eventState.get(part) ?? 0;
	eventState.set(part, value);
	if (before === value) return;

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
	return new Response("not found", { status: 404 });
});
