import { loadCharacter, loadMetric } from "./config.ts";
import { CharacterRunner } from "./runner.ts";

const characters = [
	{
		character: loadCharacter("./static/zunko/character.kdl"),
		metric: loadMetric("./static/metric.kdl"),
	},
];

for (const { character, metric } of characters) {
	new CharacterRunner(character, metric).start();
}
