import { staticPlugin } from "@elysia/static";
import { Elysia } from "elysia";
import { query } from "./prometheus.ts";
import type { Inputs, Message, Metric, Pack, Profile } from "./schema.ts";

type Line = Omit<Message, "time">;

const textEncoder = new TextEncoder();
const packPrefix = "/pack";

function pick<T>(items: T[]): T {
	return items[Math.floor(Math.random() * items.length)];
}

export class CharacterRunner {
	private assetsDir: string;
	private profileName: string;
	private pack: Pack;
	private profile: Profile;
	private metric: Metric;

	private levelState = new Map<string, string>();
	private values = new Map<string, number>();
	private listeners = new Set<(frame: string) => void>();
	private lastMessage: Message | null = null;

	constructor(
		assetsDir: string,
		profileName: string,
		pack: Pack,
		profile: Profile,
		metric: Metric,
	) {
		this.assetsDir = assetsDir;
		this.profileName = profileName;
		this.pack = pack;
		this.profile = profile;
		this.metric = metric;
	}

	private frame(event: string, data: unknown) {
		return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
	}

	private send(event: string, data: unknown) {
		for (const listener of this.listeners) {
			listener(this.frame(event, data));
		}
	}

	private publish(line: Line) {
		const message: Message = { ...line, time: Date.now() };
		this.lastMessage = message;
		this.send("message", message);
	}

	private inputs(): Inputs {
		const inputs: Inputs = {};
		for (const input of this.profile.inputs) {
			inputs[input.name] = this.values.get(input.part) ?? 0;
		}
		return inputs;
	}

	private state() {
		return {
			inputs: this.inputs(),
			levelState: Object.fromEntries(this.levelState),
		};
	}

	private conf() {
		return {
			pack: `${packPrefix}/pack.kdl`,
			profile: `${packPrefix}/profiles/${this.profileName}.kdl`,
		};
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

		// メッセージより先に送り、フロントが新しいレベルで描画できるようにする
		this.send("state", this.state());

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

			this.values.set(signal.part, value);
			this.tickLevel(signal.part, value);
		}

		this.send("state", this.state());
	}

	private messages(): Response {
		let listener: (frame: string) => void;
		const stream = new ReadableStream({
			start: (controller) => {
				listener = (frame) => {
					controller.enqueue(textEncoder.encode(frame));
				};
				listener(this.frame("state", this.state()));
				if (this.lastMessage) listener(this.frame("message", this.lastMessage));
				this.listeners.add(listener);
			},
			cancel: () => {
				this.listeners.delete(listener);
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
			.get("/conf", () => this.conf())
			.get(
				"/move",
				async () =>
					new Response(await Deno.readTextFile("dist/move.html"), {
						headers: { "content-type": "text/html; charset=utf-8" },
					}),
			)
			.use(
				staticPlugin({
					assets: this.assetsDir,
					prefix: packPrefix,
					decodeURI: true,
				}),
			)
			.use(staticPlugin({ assets: "dist", prefix: "/" }));

		Deno.serve({ port: this.metric.server.port }, app.fetch);
	}
}
