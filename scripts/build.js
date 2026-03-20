const { execSync } = require("child_process");
const path = require("path");

function runCommand(command, cwd) {
  console.log(`${command} (${cwd})`);
  try {
    execSync(command, { stdio: "inherit", cwd });
  } catch (error) {
    process.exit(1);
  }
}

const rootDir = path.resolve(__dirname, "..");
const clientDir = path.join(rootDir, "client");
const chatEngineDir = path.join(rootDir, "chat-engine");
const serverDir = path.join(rootDir, "server");

runCommand("npm run build", clientDir);
runCommand("node scripts/copy-artifact-to-server.js", clientDir);
runCommand("npm run build", chatEngineDir);
runCommand("npm run build", serverDir);
