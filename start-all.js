// Single-command launcher: registers slash commands, then runs the Discord
// bot and the analytics web server together as child processes.
//
// Usage: npm start   (or: node start-all.js)

const { spawn } = require("child_process");
const path = require("path");

const root = __dirname;
const children = [];
let shuttingDown = false;

/** Spawn a labelled child process whose output is prefixed in the console. */
function run(label, args, color, oneShot = false) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  const tag = `\x1b[${color}m[${label}]\x1b[0m`;
  const pipe = (stream, out) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) out.write(`${tag} ${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
    // A one-shot step (deploy) is expected to finish; only long-running
    // services trigger a full shutdown when they die unexpectedly.
    if (shuttingDown || oneShot) return;
    console.log(
      `${tag} exited (code=${code} signal=${signal}). Shutting down.`,
    );
    shutdown(code ?? 1);
  });

  if (!oneShot) children.push(child);
  return child;
}

/** Run a child to completion (used for the one-shot deploy step). */
function runOnce(label, args, color) {
  return new Promise((resolve, reject) => {
    const child = run(label, args, color, true);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGINT");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

(async () => {
  try {
    // 1. Register slash commands (waits for completion).
    await runOnce("deploy", [path.join(root, "deploy.js")], "36");

    // 2. Start the bot and the web server side by side.
    run("bot", [path.join(root, "bot.js")], "35");
    run("web", [path.join(root, "web", "server.js")], "32");
  } catch (err) {
    console.error("❌ Launch failed:", err.message);
    shutdown(1);
  }
})();
