import type { State } from "../src/schema.ts";
import {
	applyAnim,
	fetchState,
	loadCharacter,
	makeAnims,
	makeApplyFace,
	makeBodyRig,
	makeGroupRigs,
	setupStage,
} from "./character.ts";
import { makeTemplate } from "./template.ts";

function renderMoveList(view: HTMLElement, state: State) {
	view.replaceChildren();
	for (const move of state.moves) {
		const item = document.createElement("li");
		const link = document.createElement("a");
		link.href = `/move?name=${encodeURIComponent(move.name)}`;
		link.textContent = move.name;
		item.appendChild(link);
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

	const replayButton = document.getElementById("replay");
	if (!replayButton) return;

	const state = await fetchState();
	if (!state) return;

	renderMoveList(moveList, state);

	const name = new URLSearchParams(globalThis.location.search).get("name");
	const move = state.moves.find((m) => m.name === name);

	if (!move) {
		label.textContent = name
			? `${name} というmoveはありません`
			: "moveを選んでください";
		return;
	}

	label.textContent = move.loop ? `${move.name} (loop)` : move.name;

	const { app, viewport } = await setupStage(stage);

	const character = await loadCharacter(`/pack/${state.psd}`);
	viewport.addChild(character.container);

	const bodyRig = makeBodyRig(character.nodes, state.groups);
	const groupRigs = makeGroupRigs(character.nodes, state.groups);

	const template = makeTemplate(bodyRig);
	const applyFace = makeApplyFace(character.nodes, state.faces);

	const anims = makeAnims(move, template);
	applyFace(move.face);

	let time = 0;

	replayButton.hidden = move.loop;
	replayButton.addEventListener("click", () => {
		time = 0;
	});

	app.ticker.add((ticker) => {
		time += ticker.deltaMS / 1000;
		applyAnim(anims, time, bodyRig, groupRigs);
	});
}

main();
