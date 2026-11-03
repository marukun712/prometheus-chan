import { staticPlugin } from "@elysia/static";
import { Elysia } from "elysia";
import { query } from "./prometheus.ts";
import type { Message, Metric, Pack, Profile } from "./schema.ts";

type Line = Omit<Message, "time">;

const textEncoder = new TextEncoder();

function pick<T>(items: T[]): T {
	return items[Math.floor(Math.random() * items.length)];
}

export class CharacterRunner {
	private assetsDir: string;
	private pack: Pack;
	private profile: Profile;
	private metric: Metric;

	private levelState = new Map<string, string>();
	private messageListeners = new Set<(message: Message) => void>();
	private lastMessage: Message | null = null;

	constructor(assetsDir: string, pack: Pack, profile: Profile, metric: Metric) {
		this.assetsDir = assetsDir;
		this.pack = pack;
		this.profile = profile;
		this.metric = metric;
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
		let next = this.pack.levels[0].name;
		for (const level of this.pack.levels) {
			if (value >= level.enter) {
				next = level.name;
			}
		}
		return next;
	}

	// レベルの遷移状態を判定する
	private getLevel(value: number, current: string): string {
		const cur = this.pack.levels.find((level) => level.name === current);
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

	private say(part: string, from: string, to: string): Line | null {
		const entry = this.profile.parts.find((p) => p.id === part);
		if (!entry) return null;

		for (const transition of entry.on) {
			if (transition.to !== to) continue;
			if (!transition.from.includes("*") && !transition.from.includes(from)) {
				continue;
			}

			const line = pick(transition.says);
			return {
				part,
				text: line.line,
				voice: line.voice,
				move: line.move,
				level: to,
			};
		}
		return null;
	}

	// 部位クリック時の返事
	private askLine(part: string): Line | null {
		const level = this.levelState.get(part);
		if (!level) return null;

		const entry = this.profile.parts.find((p) => p.id === part);
		if (!entry) return null;

		for (const answer of entry.ask) {
			if (!answer.level.includes("*") && !answer.level.includes(level)) {
				continue;
			}

			const line = pick(answer.says);
			return {
				part,
				text: line.line,
				voice: line.voice,
				move: line.move,
				level,
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
		const lines: string[] = [];
		for (const part of this.profile.parts) {
			const level = this.levelState.get(part.id);
			if (level === undefined) continue;

			for (const entry of part.care) {
				if (entry.level.includes(level)) lines.push(entry.line);
			}
		}
		return lines;
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

		const from = before ?? this.pack.levels[0].name;
		const line = this.say(part, from, after);
		if (!line) return;
		this.publish(line);
	}

	private async tick() {
		for (const signal of this.metric.signals) {
			const res = await query(signal.query, this.metric.prometheus.url);
			if (res.data.resultType !== "vector") continue;
			const sample = res.data.result[0]?.value;

			if (!sample) continue;
			const value = Number(sample[1]);
			console.log(signal, value);

			this.tickLevel(signal.part, value);
		}
	}

	private state() {
		return {
			psd: this.pack.psd,
			groups: this.pack.groups,
			moves: this.pack.moves,
			levels: this.pack.levels.map((level) => ({
				name: level.name,
				label: level.label,
				color: level.color,
				move: level.move,
			})),
			parts: this.profile.parts.map((part) => ({
				id: part.id,
				label: part.label,
			})),
			levelState: Object.fromEntries(this.levelState),
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
		}, Number(this.metric.prometheus.interval));

		const app = new Elysia()
			.get("/messages", () => this.messages())
			.get("/state", () => this.state())
			.get("/ask", (ctx) => this.ask(ctx.query.part))
			.get("/care", () => this.care())
			.use(
				staticPlugin({
					assets: this.assetsDir,
					prefix: "/pack",
					decodeURI: true,
				}),
			)
			.use(staticPlugin({ assets: "dist", prefix: "/" }));

		Deno.serve({ port: this.metric.server.port }, app.fetch);
	}
}
