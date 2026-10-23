import { loadCharacter, loadMetric } from "./config.ts";
import { CharacterRunner } from "./runner.ts";

const character = loadCharacter(`./static/character/${Deno.args[0]}`);
const metric = loadMetric(`./static/metrics/${Deno.args[1]}`);

new CharacterRunner(character, metric).start();
