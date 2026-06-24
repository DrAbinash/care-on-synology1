import { spawn } from "node:child_process";

const tasks = [
  { name: "api", command: "pnpm", args: ["--filter", "@workspace/api-server", "run", "dev"] },
  { name: "erp", command: "pnpm", args: ["--filter", "@workspace/diagnostic-erp", "run", "dev"] },
];

const running = new Map();
let shuttingDown = false;

function start(task) {
  if (shuttingDown) return;
  const child = spawn(task.command, task.args, { stdio: "inherit", shell: process.platform === "win32" });
  running.set(task.name, child);
  child.on("exit", (code, signal) => {
    running.delete(task.name);
    if (shuttingDown) return;
    const delay = code === 0 ? 1000 : 3000;
    setTimeout(() => start(task), delay);
  });
}

function stopAll() {
  shuttingDown = true;
  for (const child of running.values()) {
    child.kill();
  }
  running.clear();
  setTimeout(() => process.exit(0), 1000);
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

for (const task of tasks) start(task);