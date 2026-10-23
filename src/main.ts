import { loadCharacter, loadMetric } from "./config.ts";
import { CharacterRunner } from "./runner.ts";

const characters = [
	{
		character: loadCharacter("./static/character/zunko/ix2215.kdl"),
		metric: loadMetric("./static/metrics/ix2215.kdl"),
	},
];

for (const { character, metric } of characters) {
	new CharacterRunner(character, metric).start();
}
