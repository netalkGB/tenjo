const { spawn } = require('cross-spawn');
const path = require('path');

function runCommand(command, args, cwd, name) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit'
  });

  child.on('error', (error) => {
    console.error(`Error starting ${name}:`, error);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`${name} exited with code ${code}`);
      process.exit(code);
    }
  });

  return child;
}

console.log('Starting development servers...');

const packages = [
  { dir: 'chat-engine', name: 'Chat Engine' },
  { dir: 'client', name: 'Client' },
  { dir: 'server', name: 'Server' },
];
const children = packages.map(({ dir, name }) =>
  runCommand('npm', ['run', 'dev'], path.join(__dirname, '..', dir), name)
);

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\nShutting down development servers...');
  children.forEach((child) => child.kill('SIGINT'));
  process.exit(0);
});

process.on('SIGTERM', () => {
  children.forEach((child) => child.kill('SIGTERM'));
  process.exit(0);
});