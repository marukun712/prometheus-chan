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

function speak(
	instance: string,
	part: string | undefined,
	from: string,
	to: string,
) {
	for (const event of charConf.events) {
		if (event.part !== part) continue;
		if (event.to !== to) continue;
		if (!event.from.includes("*") && !event.from.includes(from)) continue;

		const line = event.says[Math.floor(Math.random() * event.says.length)];
		const name = charConf.name.replace("{hostname}", instance);
		console.log(`${name}「${line.text}」 ${line.voice}`);
		return;
	}
}

async function tick() {
	for (const signal of metricConf.signals) {
		const res = await prom.instantQuery(signal.query);
		const r = res.result[0];
		const instance = r.metric.labels.instance;

		const before = state ?? "ok";
		const after = getLevel(r.value.value, before);

		if (before !== after) {
			speak(instance, signal.part, before, after);
		}
		state = after;
	}
}

setInterval(async () => {
	try {
		await tick();
	} catch (e) {
		console.error(e);
	}
}, Number(metricConf.prometheus.interval));
