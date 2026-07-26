const { spawn } = require('cross-spawn');
const path = require('path');

function runCommand(command, args, cwd, name) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit'
  });

  child.on('error', error => {
    console.error(`Error starting ${name}:`, error);
    process.exit(1);
  });

  child.on('exit', code => {
    if (code !== 0 && code !== null) {
      console.error(`${name} exited with code ${code}`);
      process.exit(code);
    }
  });

  return child;
}

function runCommandOnce(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function main() {
  const root = path.join(__dirname, '..');

  console.log('Building chat-engine (required before server starts)...');
  try {
    await runCommandOnce('npm', ['run', 'build'], path.join(root, 'chat-engine'));
  } catch (error) {
    console.error('Initial chat-engine build failed:', error.message);
    process.exit(1);
  }

  console.log('Starting development servers...');

  const packages = [
    { dir: 'chat-engine', name: 'Chat Engine' },
    { dir: 'client', name: 'Client' },
    { dir: 'server', name: 'Server' }
  ];
  const children = packages.map(({ dir, name }) =>
    runCommand('npm', ['run', 'dev'], path.join(root, dir), name)
  );

  const shutdown = () => {
    console.log('\nShutting down development servers...');
    children.forEach(child => child.kill('SIGINT'));
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
