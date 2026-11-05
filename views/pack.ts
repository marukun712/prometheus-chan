import type { SeqExpr } from "@kokoro/rig";
import { all, create } from "mathjs/number";
import { parsePack, parseProfile } from "../src/config.ts";
import {
	type ClipTemplate,
	ConfSchema,
	type Inputs,
	type LevelState,
	type Move,
	type Pack,
	type Profile,
} from "../src/schema.ts";

const math = create(all);

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

export function resolveMoves(pack: Pack, inputs: Inputs): Move[] {
	return pack.moves.map((move) => ({
		...move,
		groups: move.groups.map((group) => ({
			name: group.name,
			seq: resolveSeq(group.seq, inputs),
		})),
	}));
}

export async function fetchPack() {
	try {
		const res = await fetch("/conf");
		if (!res.ok) return null;
		const conf = ConfSchema.parse(await res.json());

		const [packText, profileText] = await Promise.all([
			fetch(conf.pack).then((r) => r.text()),
			fetch(conf.profile).then((r) => r.text()),
		]);

		return { pack: parsePack(packText), profile: parseProfile(profileText) };
	} catch (e) {
		console.error(e);
		return null;
	}
}

export function emptyInputs(profile: Profile): Inputs {
	const inputs: Inputs = {};
	for (const input of profile.inputs) {
		inputs[input.name] = 0;
	}
	return inputs;
}

export function currentLevel(
	pack: Pack,
	profile: Profile,
	levelState: LevelState,
) {
	const current = profile.parts.map((part) => levelState[part.id]);
	return pack.levels.filter((level) => current.includes(level.name)).at(-1);
}

export function careLines(profile: Profile, levelState: LevelState) {
	const lines: string[] = [];
	for (const part of profile.parts) {
		const level = levelState[part.id];
		if (level === undefined) continue;

		for (const entry of part.care) {
			if (entry.level.includes(level)) lines.push(entry.line);
		}
	}
	return lines;
}
