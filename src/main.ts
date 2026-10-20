import { PrometheusDriver } from "prometheus-query";
import { loadCharacter, loadMetric } from "./config.ts";

const charConf = loadCharacter("./static/example-chan/character.kdl");
const metricConf = loadMetric("./static/metric.kdl");

const prom = new PrometheusDriver({
	endpoint: metricConf.prometheus.url,
	baseURL: "/api/v1",
});

let state: string = "";

function getLevel(value: number, current: string): string {
	let next = "ok";
	for (const level of charConf.levels) {
		if (value >= level.enter) {
			next = level.name;
		}
	}

	const cur = charConf.levels.find((level) => level.name === current);
	if (cur && cur.exit !== undefined && value >= cur.exit && value < cur.enter) {
		return current;
	}

	return next;
}

function say(part: string, from: string, to: string) {
	for (const event of charConf.events) {
		if (event.part !== part) continue;
		if (event.to !== to) continue;
		if (!event.from.includes("*") && !event.from.includes(from)) continue;

		const line = event.says[Math.floor(Math.random() * event.says.length)];
		return { part, text: line.text };
	}
	return null;
}

async function tick() {
	const result = new Map<string, string>();
	for (const signal of metricConf.signals) {
		const res = await prom.instantQuery(signal.query);
		const r = res.result[0];

		const before = state ?? "ok";
		const after = getLevel(r.value.value, before);

		const text = say(signal.part, before, after);
		state = after;
		if (!text) return;
		result.set(text.part, text.text);
	}
	console.log(result);
}

setInterval(async () => {
	try {
		await tick();
	} catch (e) {
		console.error(e);
	}
}, Number(metricConf.prometheus.interval));
