const { spawn } = require('cross-spawn');
const path = require('path');

function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      shell: false,
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    process.on('error', reject);
  });
}

async function main() {
  try {
    await runCommand('biome', ['format', '--write', '.']);
    await runCommand('biome', ['lint', '--write', '.']);
    await runCommand('tsc');
    await runCommand('node', ['dist/index.js']);
  } catch (error) {
    console.error('Dev command failed:', error.message);
    process.exit(1);
  }
}

main();
