import { execFileSync } from "child_process";

const PORTS = [3100, 3200];

for (const port of PORTS) {
  const pids = getListeningPids(port);
  if (pids.length === 0) {
    console.log(`[stop] port ${port}: no listener`);
    continue;
  }

  for (const pid of pids) {
    terminatePid(pid, "SIGTERM");
    console.log(`[stop] sent SIGTERM to pid ${pid} on port ${port}`);
  }
}

await sleep(1200);

for (const port of PORTS) {
  const pids = getListeningPids(port);
  for (const pid of pids) {
    terminatePid(pid, "SIGKILL");
    console.log(`[stop] sent SIGKILL to pid ${pid} on port ${port}`);
  }
}

function getListeningPids(port) {
  try {
    const output = execFileSync(
      "lsof",
      ["-ti", `tcp:${port}`, "-sTCP:LISTEN"],
      { encoding: "utf8" },
    ).trim();

    if (!output) return [];
    return output
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function terminatePid(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch {
    // Ignore already-exited processes.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
