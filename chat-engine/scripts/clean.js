const fs = require('fs');
const path = require('path');

function removeDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log(`Removed: ${dirPath}`);
  }
}

removeDirectory(path.join(__dirname, '../dist'));
removeDirectory(path.join(__dirname, '../coverage'));
