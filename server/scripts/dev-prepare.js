const { resolveBin, runCommand } = require('./devUtils');

/**
 * One-shot format/lint before nodemon starts watching.
 * Running these inside the nodemon exec rewrites .ts files and restarts the
 * process mid-boot (first `npm run dev` looks broken; second run is clean).
 */
async function main() {
  try {
    const biome = resolveBin('biome');
    await runCommand(biome, ['format', '--write', '.']);
    await runCommand(biome, ['lint', '--write', '.']);
  } catch (error) {
    console.error('Dev prepare failed:', error.message);
    process.exit(1);
  }
}

main();
