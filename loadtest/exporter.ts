const CPU_COUNT = 2;
const MEMORY_TOTAL = 2 * 1024 * 1024 * 1024;
const DISK_SIZE = 20 * 1024 * 1024 * 1024;
const NETWORK_SPEED_BYTES = (1000 * 1000 * 1000) / 8;
const DISK_DEVICE = "/dev/vda1";
const NETWORK_DEVICE = "eth0";

type State = {
	cpu: number;
	memory: number;
	disk: number;
	rx: number;
	tx: number;
	temperature: number;
};

const state: State = {
	cpu: 0.95,
	memory: 0.1,
	disk: 0.1,
	rx: 0.1,
	tx: 0.1,
	temperature: 1,
};

type Control = {
	key: keyof State;
	label: string;
	max: number;
	step: number;
};

const controls: Control[] = [
	{ key: "cpu", label: "CPU使用率", max: 1, step: 0.01 },
	{ key: "memory", label: "メモリ使用率", max: 1, step: 0.01 },
	{ key: "disk", label: "ディスク使用率", max: 1, step: 0.01 },
	{ key: "rx", label: "受信帯域使用率", max: 1, step: 0.01 },
	{ key: "tx", label: "送信帯域使用率", max: 1, step: 0.01 },
	{ key: "temperature", label: "温度(C)", max: 100, step: 1 },
];

const stateKeys = controls.map((control) => control.key);

let cpuIdleSeconds = 0;
let cpuUserSeconds = 0;
let receiveBytes = 0;
let transmitBytes = 0;
let lastAdvance = Date.now();

function advance() {
	const now = Date.now();
	const elapsed = (now - lastAdvance) / 1000;
	lastAdvance = now;

	cpuIdleSeconds += elapsed * (1 - state.cpu);
	cpuUserSeconds += elapsed * state.cpu;
	receiveBytes += elapsed * NETWORK_SPEED_BYTES * state.rx;
	transmitBytes += elapsed * NETWORK_SPEED_BYTES * state.tx;
}

function applyParams(params: URLSearchParams) {
	for (const key of stateKeys) {
		const raw = params.get(key);
		if (raw === null) continue;

		const value = Number(raw);
		if (Number.isFinite(value)) {
			state[key] = value;
		}
	}
}

function buildMetrics(): string {
	const lines: string[] = [];

	lines.push("# TYPE node_cpu_seconds_total counter");
	for (let cpu = 0; cpu < CPU_COUNT; cpu++) {
		lines.push(
			`node_cpu_seconds_total{cpu="${cpu}",mode="idle"} ${cpuIdleSeconds.toFixed(
				3,
			)}`,
		);
		lines.push(
			`node_cpu_seconds_total{cpu="${cpu}",mode="user"} ${cpuUserSeconds.toFixed(
				3,
			)}`,
		);
	}

	lines.push("# TYPE node_memory_MemTotal_bytes gauge");
	lines.push(`node_memory_MemTotal_bytes ${MEMORY_TOTAL}`);
	lines.push("# TYPE node_memory_MemAvailable_bytes gauge");
	lines.push(
		`node_memory_MemAvailable_bytes ${Math.round(
			MEMORY_TOTAL * (1 - state.memory),
		)}`,
	);

	const diskLabels = `device="${DISK_DEVICE}",fstype="ext4",mountpoint="/"`;
	lines.push("# TYPE node_filesystem_size_bytes gauge");
	lines.push(`node_filesystem_size_bytes{${diskLabels}} ${DISK_SIZE}`);
	lines.push("# TYPE node_filesystem_avail_bytes gauge");
	lines.push(
		`node_filesystem_avail_bytes{${diskLabels}} ${Math.round(
			DISK_SIZE * (1 - state.disk),
		)}`,
	);

	const networkLabels = `device="${NETWORK_DEVICE}"`;
	lines.push("# TYPE node_network_speed_bytes gauge");
	lines.push(
		`node_network_speed_bytes{${networkLabels}} ${NETWORK_SPEED_BYTES}`,
	);
	lines.push("# TYPE node_network_receive_bytes_total counter");
	lines.push(
		`node_network_receive_bytes_total{${networkLabels}} ${Math.round(
			receiveBytes,
		)}`,
	);
	lines.push("# TYPE node_network_transmit_bytes_total counter");
	lines.push(
		`node_network_transmit_bytes_total{${networkLabels}} ${Math.round(
			transmitBytes,
		)}`,
	);

	lines.push("# TYPE node_hwmon_temp_celsius gauge");
	lines.push(
		`node_hwmon_temp_celsius{chip="platform_coretemp_0",sensor="temp1"} ${state.temperature}`,
	);

	return `${lines.join("\n")}\n`;
}

function buildPage(): string {
	const items = controls
		.map(
			(control) => `      <li>
        <label for="${control.key}">${control.label}</label>
        <input type="range" id="${control.key}" min="0" max="${control.max}" step="${control.step}" value="${state[control.key]}" />
        <output id="${control.key}-value">${state[control.key]}</output>
      </li>`,
		)
		.join("\n");

	return `<!doctype html>
<html lang="ja">

<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>loadtest exporter</title>
  <style>
    body {
      margin: 0 auto;
      padding: 24px 16px;
      max-width: 520px;
      font-family: sans-serif;
      font-size: 15px;
      color: #333333;
    }

    h1 {
      margin: 0 0 20px;
      font-size: 18px;
    }

    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    li {
      display: grid;
      grid-template-columns: 9em 1fr 4em;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid #e8e8e8;
    }

    output {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
  </style>
</head>

<body>
  <h1>loadtest exporter</h1>
  <ul>
${items}
  </ul>
  <script>
    for (const input of document.querySelectorAll("input[type=range]")) {
      input.addEventListener("input", () => {
        document.getElementById(input.id + "-value").textContent = input.value;
        fetch("/state?" + input.id + "=" + input.value);
      });
    }
  </script>
</body>

</html>
`;
}

function handler(request: Request): Response {
	const url = new URL(request.url);
	advance();

	if (url.pathname === "/") {
		return new Response(buildPage(), {
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	if (url.pathname === "/metrics") {
		return new Response(buildMetrics(), {
			headers: { "content-type": "text/plain; version=0.0.4" },
		});
	}

	if (url.pathname === "/state") {
		applyParams(url.searchParams);
		return Response.json(state);
	}

	return new Response("not found", { status: 404 });
}

Deno.serve({ port: 9100 }, handler);
