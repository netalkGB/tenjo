import { execSync, spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const serverDir = path.join(rootDir, "server");

console.log("Running build...");
execSync("node scripts/build.js", { stdio: "inherit", cwd: rootDir });

console.log("Starting server...");
const server = spawn("node", ["dist/index.js"], {
  stdio: "inherit",
  cwd: serverDir,
});

server.on("error", (err) => {
  console.error("Failed to start server:", err.message);
  process.exit(1);
});

process.on("SIGINT", () => {
  server.kill("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.kill("SIGTERM");
  process.exit(0);
});
