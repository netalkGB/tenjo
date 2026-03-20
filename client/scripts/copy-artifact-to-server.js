import fs from 'fs';
import path from 'path';

const clientDistDir = 'dist';
const serverViewsDir = '../server/.views';
const serverStaticDir = '../server/.static';
const serverPublicDir = '../server/.public';

// Clean and recreate output directories
for (const dir of [serverViewsDir, serverStaticDir, serverPublicDir]) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
print('Cleaned output directories');

// Copy HTML file to .views as index.ejs
const htmlFile = path.join(clientDistDir, 'index.html');
if (fs.existsSync(htmlFile)) {
  const htmlContent = fs.readFileSync(htmlFile, 'utf8');
  fs.writeFileSync(path.join(serverViewsDir, 'index.ejs'), htmlContent);
  print('Copied index.html to server/.views/index.ejs');
}

// Copy assets (JS and CSS files) to .static
const assetsDir = path.join(clientDistDir, 'assets');
if (fs.existsSync(assetsDir)) {
  const files = fs.readdirSync(assetsDir);

  files.forEach(file => {
    const srcFile = path.join(assetsDir, file);
    const destFile = path.join(serverStaticDir, file);

    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, destFile);
      print(`Copied ${file} to server/.static/`);
    }
  });
}

// Copy root-level public files (e.g., logo.svg, favicon.ico) to .public
const distFiles = fs.readdirSync(clientDistDir);
distFiles.forEach(file => {
  const srcFile = path.join(clientDistDir, file);
  if (fs.statSync(srcFile).isFile() && file !== 'index.html' && !file.startsWith('.')) {
    fs.copyFileSync(srcFile, path.join(serverPublicDir, file));
    print(`Copied ${file} to server/.public/`);
  }
});

print('Artifact copy completed!');

function print(string) {
  // eslint-disable-next-line no-undef
  console.log(string);
}
