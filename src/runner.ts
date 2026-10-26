import { staticPlugin } from "@elysia/static";
import { Elysia } from "elysia";
import type { Character, Metric } from "./config.ts";
import { query } from "./prometheus.ts";

type Message = {
	part: string;
	text: string;
	voice?: string;
	image?: string;
	level?: string;
	time: number;
};

type Line = Omit<Message, "time">;

const textEncoder = new TextEncoder();

function pick<T>(items: T[]): T {
	return items[Math.floor(Math.random() * items.length)];
}

export class CharacterRunner {
	private charConf: Character;
	private metricConf: Metric;
	private levelState = new Map<string, string>();
	private eventState = new Map<string, number>();
	private messageListeners = new Set<(message: Message) => void>();
	private lastMessage: Message | null = null;

	constructor(charConf: Character, metricConf: Metric) {
		this.charConf = charConf;
		this.metricConf = metricConf;
	}

	private publish(line: Line) {
		const message: Message = { ...line, time: Date.now() };
		this.lastMessage = message;
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

	// レベルごとのデフォルト立ち絵
	private levelImage(levelName: string): string | undefined {
		const level = this.charConf.levels.find((l) => l.name === levelName);
		return level?.image;
	}

	private say(part: string, from: string, to: string): Line | null {
		for (const event of this.charConf.on) {
			if (event.part !== part) continue;
			if (event.to !== to) continue;
			if (!event.from.includes("*") && !event.from.includes(from)) continue;

			// say行の立ち絵/音声上書きがある場合はそれを使用
			const line = pick(event.says);
			const voice = line.voice ?? this.levelVoice(to);
			const image = line.image ?? this.levelImage(to);
			return {
				part,
				text: line.line,
				voice,
				level: to,
				image,
			};
		}
		return null;
	}

	private react(part: string, when: "rise" | "fall"): Line | null {
		for (const reaction of this.charConf.react) {
			if (reaction.event !== part) continue;
			if (reaction.when !== when) continue;

			// reactにはデフォルト立ち絵は設定できないため、say行で立ち絵が定義されている場合のみ含まれる
			const line = pick(reaction.says);
			return {
				part,
				text: line.line,
				voice: line.voice,
				image: line.image,
			};
		}
		return null;
	}

	// 部位クリック時の返事
	private askLine(part: string): Line | null {
		const level = this.levelState.get(part);
		if (!level) return null;

		for (const entry of this.charConf.ask) {
			if (entry.part !== part) continue;
			if (!entry.level.includes("*") && !entry.level.includes(level)) continue;

			const line = pick(entry.says);
			return {
				part,
				text: line.line,
				voice: line.voice,
				level,
				image: line.image,
			};
		}
		return null;
	}

	private ask(part: string | undefined) {
		if (!part) return { ok: false };

		const line = this.askLine(part);
		if (!line) return { ok: false };

		this.publish(line);
		return { ok: true };
	}

	// 現在のレベルに当てはまるおせわの要望だけを返す
	private care(): string[] {
		return this.charConf.care
			.filter((entry) => {
				const level = this.levelState.get(entry.part);
				return level !== undefined && entry.level.includes(level);
			})
			.map((entry) => entry.line);
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

		const from = before ?? this.charConf.levels[0].name;
		const line = this.say(part, from, after);
		if (!line) return;
		this.publish(line);
	}

	private tickEvent(part: string, value: number) {
		const before = this.eventState.get(part) ?? 0;
		this.eventState.set(part, value);
		if (before === value) return;

		// 値の上昇/下降の判定
		const when = value > before ? "rise" : "fall";
		const reaction = this.react(part, when);
		if (!reaction) return;

		this.publish(reaction);
	}

	private async tick() {
		for (const signal of this.metricConf.signals) {
			const res = await query(signal.query, this.metricConf.prometheus.url);
			if (res.data.resultType !== "vector") continue;
			const sample = res.data.result[0]?.value;

			if (!sample) continue;
			const value = Number(sample[1]);
			console.log(signal, value);

			if (this.charConf.events.includes(signal.part)) {
				this.tickEvent(signal.part, value);
			} else {
				this.tickLevel(signal.part, value);
			}
		}
	}

	private state() {
		return {
			levels: this.charConf.levels.map((level) => ({
				name: level.name,
				label: level.label,
				color: level.color,
			})),
			parts: this.charConf.parts,
			levelState: Object.fromEntries(this.levelState),
			eventState: Object.fromEntries(this.eventState),
		};
	}

	private messages(): Response {
		let listener: (message: Message) => void;
		const stream = new ReadableStream({
			start: (controller) => {
				listener = (message) => {
					controller.enqueue(
						textEncoder.encode(`data: ${JSON.stringify(message)}\n\n`),
					);
				};
				if (this.lastMessage) listener(this.lastMessage);
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

		const app = new Elysia()
			.get("/messages", () => this.messages())
			.get("/state", () => this.state())
			.get("/ask", (ctx) => this.ask(ctx.query.part))
			.get("/care", () => this.care())
			// 日本語のファイル名を扱うため、URLのデコードを有効にする
			.use(
				staticPlugin({
					assets: "static",
					prefix: "/static",
					decodeURI: true,
				}),
			)
			.use(staticPlugin({ assets: "dist", prefix: "/" }));

		Deno.serve({ port: this.metricConf.server.port }, app.fetch);
	}
}
