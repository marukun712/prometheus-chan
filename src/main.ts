import { loadCharacter, loadMetric } from "./config.ts";
import { CharacterRunner } from "./runner.ts";

const character = loadCharacter(`./conf/character/${Deno.args[0]}`);
const metric = loadMetric(`./conf/metrics/${Deno.args[1]}`);

new CharacterRunner(character, metric).start();
