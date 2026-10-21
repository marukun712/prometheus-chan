import type { Character, Metric } from "./config.ts";
import { query } from "./prometheus.ts";

type Message = {
	part: string;
	text: string;
	time: number;
};

const textEncoder = new TextEncoder();

export class CharacterRunner {
	private charConf: Character;
	private metricConf: Metric;
	private levelState = new Map<string, string>();
	private eventState = new Map<string, number>();
	private currentVoice: string | undefined;
	private messageListeners = new Set<(message: Message) => void>();

	constructor(charConf: Character, metricConf: Metric) {
		this.charConf = charConf;
		this.metricConf = metricConf;
	}

	private publish(part: string, text: string, voice: string | undefined) {
		this.currentVoice = voice;
		const message: Message = { part, text, time: Date.now() };
		for (const listener of this.messageListeners) {
			listener(message);
		}
	}

	// valueからレベルを判定する
	private levelForValue(value: number): string {
		let next = this.charConf.levels[0].name;
		for (const level of this.charConf.levels) {
			if (value >= level.enter) {
				next = level.name;
			}
		}
		return next;
	}

	// レベルの遷移状態を判定する
	private getLevel(value: number, current: string): string {
		const cur = this.charConf.levels.find((level) => level.name === current);
		if (
			cur &&
			cur.exit !== undefined &&
			value >= cur.exit &&
			value < cur.enter
		) {
			return current;
		}

		return this.levelForValue(value);
	}

	// レベルごとにボイスをランダム選択
	private levelVoice(levelName: string): string | undefined {
		const level = this.charConf.levels.find((l) => l.name === levelName);
		if (!level || level.voices.length === 0) return undefined;
		return level.voices[Math.floor(Math.random() * level.voices.length)];
	}

	private say(part: string, from: string, to: string) {
		for (const event of this.charConf.events) {
			if (event.part !== part) continue;
			if (event.to !== to) continue;
			if (!event.from.includes("*") && !event.from.includes(from)) continue;

			// say行にボイスが設定されている場合はそのボイスを使う
			const line = event.says[Math.floor(Math.random() * event.says.length)];
			const voice = line.voice ?? this.levelVoice(to);
			return { part, text: line.text, voice };
		}
		return null;
	}

	private react(part: string, when: "rise" | "fall") {
		for (const reaction of this.charConf.reactions) {
			if (reaction.event !== part) continue;
			if (reaction.when !== when) continue;

			const line =
				reaction.says[Math.floor(Math.random() * reaction.says.length)];
			return { part, text: line.text, voice: line.voice };
		}
		return null;
	}

	private tickLevel(part: string, value: number) {
		// 現在のレベルがない場合は、valueをそのまま評価
		const before = this.levelState.get(part);
		// レベルが存在している場合は遷移を評価する
		const after =
			before === undefined
				? this.levelForValue(value)
				: this.getLevel(value, before);
		this.levelState.set(part, after);
		if (before === after) return;

		const from = before ?? after;
		const text = this.say(part, from, after);
		if (!text) return;
		this.publish(text.part, text.text, text.voice);
	}

	private tickEvent(part: string, value: number) {
		const before = this.eventState.get(part) ?? 0;
		this.eventState.set(part, value);
		if (before === value) return;

		// 値の上昇/下降の判定
		const when = value > before ? "rise" : "fall";
		const reaction = this.react(part, when);
		if (!reaction) return;

		this.publish(reaction.part, reaction.text, reaction.voice);
	}

	private async tick() {
		for (const signal of this.metricConf.signals) {
			const res = await query(signal.query, this.metricConf.prometheus.url);
			if (res.data.resultType !== "vector") continue;
			const sample = res.data.result[0]?.value;
			console.log(signal, sample);

			if (!sample) continue;
			const value = Number(sample[1]);

			if (this.charConf.eventParts.includes(signal.part)) {
				this.tickEvent(signal.part, value);
			} else {
				this.tickLevel(signal.part, value);
			}
		}
	}

	private handleState(): Response {
		const levels: Record<string, string> = {};
		for (const [part, level] of this.levelState) {
			levels[part] = level;
		}
		const events: Record<string, number> = {};
		for (const [part, value] of this.eventState) {
			events[part] = value;
		}
		return Response.json({ levels, events });
	}

	private handleVoice(): Response {
		if (!this.currentVoice) return new Response("no voice", { status: 404 });
		try {
			const bytes = Deno.readFileSync(`./static/${this.currentVoice}`);
			return new Response(bytes, { headers: { "content-type": "audio/wav" } });
		} catch {
			return new Response("not found", { status: 404 });
		}
	}

	private handleMessages(): Response {
		let listener: (message: Message) => void;
		const stream = new ReadableStream({
			start: (controller) => {
				listener = (message) => {
					controller.enqueue(
						textEncoder.encode(`data: ${JSON.stringify(message)}\n`),
					);
				};
				this.messageListeners.add(listener);
			},
			cancel: () => {
				this.messageListeners.delete(listener);
			},
		});
		return new Response(stream, {
			headers: { "content-type": "text/event-stream" },
		});
	}

	start() {
		setInterval(async () => {
			try {
				await this.tick();
			} catch (e) {
				console.error(e);
			}
		}, Number(this.metricConf.prometheus.interval));

		Deno.serve({ port: this.metricConf.server.port }, (req) => {
			const url = new URL(req.url);
			if (url.pathname === "/state") return this.handleState();
			if (url.pathname === "/messages") return this.handleMessages();
			if (url.pathname === "/voice") return this.handleVoice();
			return new Response("not found", { status: 404 });
		});
	}
}
