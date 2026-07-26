const { spawn } = require('cross-spawn');
const path = require('path');
const fs = require('fs');

const serverRoot = path.join(__dirname, '..');
const monorepoRoot = path.join(serverRoot, '..');

function resolveBin(name) {
  const candidates = [
    path.join(serverRoot, 'node_modules', '.bin', name),
    path.join(monorepoRoot, 'node_modules', '.bin', name)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return name;
}

function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: serverRoot,
      shell: false,
      env: {
        ...process.env,
        PATH: [
          path.join(serverRoot, 'node_modules', '.bin'),
          path.join(monorepoRoot, 'node_modules', '.bin'),
          process.env.PATH || ''
        ].join(path.delimiter)
      }
    });

    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

module.exports = {
  resolveBin,
  runCommand,
  serverRoot
};
