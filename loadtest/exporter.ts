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
	sessions: number;
	oomKills: number;
};

const state: State = {
	cpu: 0.95,
	memory: 0.8,
	disk: 0.4,
	rx: 0.05,
	tx: 0.05,
	temperature: 45,
	sessions: 0,
	oomKills: 0,
};

const stateKeys: (keyof State)[] = [
	"cpu",
	"memory",
	"disk",
	"rx",
	"tx",
	"temperature",
	"sessions",
	"oomKills",
];

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

	lines.push("# TYPE node_logind_sessions gauge");
	lines.push(
		`node_logind_sessions{class="user",remote="true",type="tty"} ${state.sessions}`,
	);

	lines.push("# TYPE node_vmstat_oom_kill untyped");
	lines.push(`node_vmstat_oom_kill ${state.oomKills}`);

	return `${lines.join("\n")}\n`;
}

function handler(request: Request): Response {
	const url = new URL(request.url);
	advance();

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
