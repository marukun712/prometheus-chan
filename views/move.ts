import type { Animation } from "@kokoro/rig";
import type { Inputs, Pack, Profile } from "../src/schema.ts";
import {
	applyAnim,
	loadCharacter,
	makeAnims,
	makeApplyFace,
	makeBodyRig,
	makeGroupRigs,
	setupStage,
} from "./character.ts";
import { emptyInputs, fetchPack, resolveMoves } from "./pack.ts";
import { makeTemplate } from "./template.ts";

function renderMoveList(view: HTMLElement, pack: Pack) {
	view.replaceChildren();
	for (const move of pack.moves) {
		const item = document.createElement("li");
		const link = document.createElement("a");
		link.href = `/move?name=${encodeURIComponent(move.name)}`;
		link.textContent = move.name;
		item.appendChild(link);
		view.appendChild(item);
	}
}

function renderInputs(
	view: HTMLElement,
	profile: Profile,
	inputs: Inputs,
	onChange: () => void,
) {
	view.replaceChildren();
	for (const input of profile.inputs) {
		const item = document.createElement("li");

		const label = document.createElement("label");
		label.textContent = input.name;

		const range = document.createElement("input");
		range.type = "range";
		range.min = "0";
		range.max = "1";
		range.step = "0.01";
		range.value = String(inputs[input.name]);

		const value = document.createElement("output");
		value.textContent = range.value;

		range.addEventListener("input", () => {
			inputs[input.name] = Number(range.value);
			value.textContent = range.value;
			onChange();
		});

		label.appendChild(range);
		label.appendChild(value);
		item.appendChild(label);
		view.appendChild(item);
	}
}

async function main() {
	const stage = document.getElementById("stage");
	if (!stage) return;

	const label = document.getElementById("label");
	if (!label) return;

	const moveList = document.getElementById("moves");
	if (!moveList) return;

	const inputList = document.getElementById("inputs");
	if (!inputList) return;

	const replayButton = document.getElementById("replay");
	if (!replayButton) return;

	const loaded = await fetchPack();
	if (!loaded) return;
	const { pack, profile } = loaded;

	renderMoveList(moveList, pack);

	const name = new URLSearchParams(globalThis.location.search).get("name");
	const template = pack.moves.find((m) => m.name === name);

	if (!template) {
		label.textContent = name
			? `${name} というmoveはありません`
			: "moveを選んでください";
		return;
	}

	label.textContent = template.loop ? `${template.name} (loop)` : template.name;

	const { app, viewport } = await setupStage(stage);

	const character = await loadCharacter(`/pack/${pack.psd}`);
	viewport.addChild(character.container);

	const bodyRig = makeBodyRig(character.nodes, pack.groups);
	const groupRigs = makeGroupRigs(character.nodes, pack.groups);

	const poseTemplate = makeTemplate(bodyRig);
	const applyFace = makeApplyFace(character.nodes, pack.faces);

	const inputs = emptyInputs(profile);
	const resolve = () => {
		const move = resolveMoves(pack, inputs).find((m) => m.name === name);
		if (!move) return new Map<string, Animation>();
		return makeAnims(move, poseTemplate);
	};

	let anims = resolve();
	applyFace(template.face);

	renderInputs(inputList, profile, inputs, () => {
		anims = resolve();
	});

	let time = 0;

	replayButton.hidden = template.loop;
	replayButton.addEventListener("click", () => {
		time = 0;
	});

	app.ticker.add((ticker) => {
		time += ticker.deltaMS / 1000;
		applyAnim(anims, time, bodyRig, groupRigs);
	});
}

main();
