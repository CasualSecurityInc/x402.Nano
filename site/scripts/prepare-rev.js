const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.resolve(__dirname, '../../docs');
const TARGET_DIR = path.resolve(__dirname, '../gen/docs');
const EXTENSIONS_DIR = path.join(TARGET_DIR, 'extensions');

// Ensure target directories exist and are clean
if (fs.existsSync(TARGET_DIR)) {
  fs.rmSync(TARGET_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TARGET_DIR, { recursive: true });
fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });

// Copy core docs
const coreFiles = [
  { src: 'index.md', dest: 'index.md' },
  { src: 'protocol.md', dest: 'protocol.md' },
];

coreFiles.forEach(({ src, dest }) => {
  const srcPath = path.join(SOURCE_DIR, src);
  const destPath = path.join(TARGET_DIR, dest);
  fs.copyFileSync(srcPath, destPath);
  console.log(`Copied: ${src} -> ${dest}`);
});

// Copy extension docs into extensions/
const extensionFiles = [
  'track-a-nanotxn.md',
  'track-b-nanosignature.md',
];

extensionFiles.forEach(file => {
  const srcPath = path.join(SOURCE_DIR, file);
  const destPath = path.join(EXTENSIONS_DIR, file);
  fs.copyFileSync(srcPath, destPath);
  console.log(`Copied: ${file} -> extensions/${file}`);
});

// Copy demo pages
const demoFiles = [
  path.join(__dirname, '../protected.md'),
  path.join(__dirname, '../demo-track-a.md'),
  path.join(__dirname, '../demo-track-b.md'),
];

demoFiles.forEach(src => {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(TARGET_DIR, path.basename(src)));
    console.log(`Copied demo: ${path.basename(src)}`);
  }
});
