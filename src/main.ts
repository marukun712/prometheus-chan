import { loadMetric, loadPack, loadProfile } from "./config.ts";
import { CharacterRunner } from "./runner.ts";

const [target, metricFile] = Deno.args;
const [packName, profileName] = (target ?? "").split("/");

if (!packName || !profileName || !metricFile) {
	console.error("使い方: deno task runner <pack>/<profile> <metrics>");
	Deno.exit(1);
}

const packDir = `./packs/${packName}`;
const pack = loadPack(`${packDir}/pack.kdl`);
const profile = loadProfile(`${packDir}/profiles/${profileName}.kdl`);
const metric = loadMetric(`./conf/metrics/${metricFile}`);

new CharacterRunner(packDir, pack, profile, metric).start();
