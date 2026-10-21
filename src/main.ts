import { CharacterRunner } from "./character-runner.ts";
import { loadCharacter, loadMetric } from "./config.ts";

const characters = [
	{
		character: loadCharacter("./static/kiritan/character.kdl"),
		metric: loadMetric("./static/metric.kdl"),
	},
];

for (const { character, metric } of characters) {
	new CharacterRunner(character, metric).start();
}
