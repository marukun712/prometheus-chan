import { ZodError } from "zod";
import { parseMetric, parsePack, parseProfile } from "./config.ts";

function load<T>(path: string, parse: (text: string) => T): T {
	try {
		return parse(Deno.readTextFileSync(path));
	} catch (e) {
		if (e instanceof ZodError) {
			console.error(`${path} の設定が不正です`, e.issues);
		} else {
			console.error(`${path} を読み込めません`, e);
		}
		Deno.exit(1);
	}
}

export const loadPack = (path: string) => load(path, parsePack);
export const loadProfile = (path: string) => load(path, parseProfile);
export const loadMetric = (path: string) => load(path, parseMetric);
