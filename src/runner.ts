import { staticPlugin } from "@elysia/static";
import type { SeqExpr } from "@kokoro/rig";
import { Elysia } from "elysia";
import { all, create } from "mathjs";
import { query } from "./prometheus.ts";
import type { ClipTemplate, Message, Metric, Pack, Profile } from "./schema.ts";

type Line = Omit<Message, "time">;
type Inputs = Record<string, number>;

const textEncoder = new TextEncoder();
const math = create(all);

function pick<T>(items: T[]): T {
	return items[Math.floor(Math.random() * items.length)];
}

function resolveValue(value: number | string, inputs: Inputs) {
	if (typeof value === "number") return value;
	return Number(math.evaluate(value, inputs));
}

function resolveSeq(seq: ClipTemplate[], inputs: Inputs): SeqExpr {
	return seq.map((clip) => ({
		...clip,
		pose:
			typeof clip.pose === "string"
				? clip.pose
				: { ...clip.pose, t: resolveValue(clip.pose.t, inputs) },
		duration: resolveValue(clip.duration, inputs),
	}));
}

export class CharacterRunner {
	private assetsDir: string;
	private pack: Pack;
	private profile: Profile;
	private metric: Metric;

	private levelState = new Map<string, string>();
	private values = new Map<string, number>();
	private listeners = new Set<(frame: string) => void>();
	private lastMessage: Message | null = null;

	constructor(assetsDir: string, pack: Pack, profile: Profile, metric: Metric) {
		this.assetsDir = assetsDir;
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

	// 入力名ごとに、profileで指定されたpartの値を入れる
	private inputs(): Inputs {
		const inputs: Inputs = {};
		for (const input of this.profile.inputs) {
			inputs[input.name] = this.values.get(input.part) ?? 0;
		}
		return inputs;
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

			this.values.set(signal.part, value);
			this.tickLevel(signal.part, value);
		}

		this.send("values", this.inputs());
	}

	private state() {
		const inputs = this.inputs();
		return {
			psd: this.pack.psd,
			faces: this.pack.faces,
			groups: this.pack.groups,
			moves: this.pack.moves.map((move) => ({
				...move,
				groups: move.groups.map((group) => ({
					name: group.name,
					seq: resolveSeq(group.seq, inputs),
				})),
			})),
			levels: this.pack.levels.map((level) => ({
				name: level.name,
				label: level.label,
				color: level.color,
				face: level.face,
				move: level.move,
				voice: level.voice,
			})),
			parts: this.profile.parts.map((part) => ({
				id: part.id,
				label: part.label,
			})),
			levelState: Object.fromEntries(this.levelState),
		};
	}

	private messages(): Response {
		let listener: (frame: string) => void;
		const stream = new ReadableStream({
			start: (controller) => {
				listener = (frame) => {
					controller.enqueue(textEncoder.encode(frame));
				};
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
			.get("/state", () => this.state())
			.get("/care", () => this.care())
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
					prefix: "/pack",
					decodeURI: true,
				}),
			)
			.use(staticPlugin({ assets: "dist", prefix: "/" }));

		Deno.serve({ port: this.metric.server.port }, app.fetch);
	}
}
