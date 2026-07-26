const { resolveBin, runCommand } = require('./devUtils');

/**
 * Compile and run the server. Invoked by nodemon on each src change.
 * Format/lint are intentionally not here (see dev-prepare.js).
 */
async function main() {
  try {
    await runCommand(resolveBin('tsc'), []);
    await runCommand(process.execPath, ['dist/index.js']);
  } catch (error) {
    console.error('Dev run failed:', error.message);
    process.exit(1);
  }
}

main();
