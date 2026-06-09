const fs = require('fs');
const path = require('path');

const SPEC_REV = process.env.SPEC_REV;
if (!SPEC_REV) {
  console.error('ERROR: SPEC_REV environment variable is required. ("revX")');
  process.exit(1);
}
const SOURCE_DIR = path.resolve(__dirname, '../../docs');
const TARGET_DIR = path.resolve(__dirname, '../gen/docs');
const EXTENSIONS_DIR = path.join(TARGET_DIR, 'extensions');
const APPENDIX_DIR = path.join(TARGET_DIR, 'appendix');

console.log(`Building documentation for revision: ${SPEC_REV}`);

// Ensure target directories exist and are clean
if (fs.existsSync(TARGET_DIR)) {
  fs.rmSync(TARGET_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TARGET_DIR, { recursive: true });
fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
fs.mkdirSync(APPENDIX_DIR, { recursive: true });
// Filter and classify files
const files = fs.readdirSync(SOURCE_DIR);
let introFile = null;
let protocolFile = null;
let glossaryFile = null;
const extensionFiles = [];
const appendixFiles = [];

files.forEach(file => {
  if (file.includes(SPEC_REV) && file.startsWith('x402_NanoSession_')) {
    if (file.includes('Intro')) {
      introFile = file;
    } else if (file.includes('Protocol')) {
      protocolFile = file;
    } else if (file.includes('Glossary')) {
      glossaryFile = file;
    } else if (file.includes('Appendix')) {
      appendixFiles.push(file);
    } else {
      extensionFiles.push(file);
    }
  }
});

if (!introFile || !protocolFile) {
  console.error(`ERROR: Missing core files for revision ${SPEC_REV}!`);
  process.exit(1);
}

// Pass 1: Build comprehensive file mapping
const fileMapping = {};
fileMapping[introFile] = '/';
fileMapping[protocolFile] = '/protocol';
if (glossaryFile) fileMapping[glossaryFile] = '/appendix/glossary';

extensionFiles.forEach(file => {
  const simpleName = file
    .replace(/^x402_NanoSession_rev\d+_/, '')
    .replace(/_/g, '-')
    .toLowerCase()
    .replace('.md', '');
  fileMapping[file] = `/extensions/${simpleName}`;
  // Also map versions without rev for robustness
  fileMapping[file.replace(/_rev\d+/, '')] = `/extensions/${simpleName}`;
});

appendixFiles.forEach(file => {
  const simpleName = file
    .replace(/^x402_NanoSession_rev\d+_Appendix_/, '')
    .replace(/_/g, '-')
    .toLowerCase()
    .replace('.md', '');
  fileMapping[file] = `/appendix/${simpleName}`;
  fileMapping[file.replace(/_rev\d+/, '')] = `/appendix/${simpleName}`;
});

// Helper to replace links in content
function replaceLinks(content) {
  let newContent = content;
  Object.keys(fileMapping).forEach(sourceName => {
    const escapedName = sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match both [text](file.md) and [text](./file.md), including optional anchors #
    const regex = new RegExp(`\\((?:\\.\\/)?${escapedName}(#[^)]*)?\\)`, 'g');
    newContent = newContent.replace(regex, (match, anchor) => `(${fileMapping[sourceName]}${anchor || ''})`);
  });
  return newContent;
}

// Pass 2: Process and write files
const extensionLinks = [];

// Extensions
extensionFiles.sort().forEach(file => {
  const content = fs.readFileSync(path.join(SOURCE_DIR, file), 'utf8');
  const targetPath = path.join(EXTENSIONS_DIR, fileMapping[file].split('/').pop() + '.md');

  // Extract Title
  const titleMatch = content.match(/^#\s+(.*)$/m);
  const title = titleMatch ? titleMatch[1] : file;
  extensionLinks.push({ text: title, link: fileMapping[file] });

  let newContent = replaceLinks(content);
  fs.writeFileSync(targetPath, newContent);
  console.log(`Processed Extension: ${file} -> ${targetPath}`);
});

// Protocol
const protocolContent = fs.readFileSync(path.join(SOURCE_DIR, protocolFile), 'utf8');
let seeAlso = `\n\n## 📚 Related Extensions\n`;
extensionLinks.forEach(ext => { seeAlso += `- [${ext.text}](${ext.link})\n`; });

const finalProtocolContent = replaceLinks(protocolContent) + seeAlso;
fs.writeFileSync(path.join(TARGET_DIR, 'protocol.md'), finalProtocolContent);
console.log(`Processed Protocol: ${protocolFile} -> protocol.md`);

// Intro (index.md)
const introContent = fs.readFileSync(path.join(SOURCE_DIR, introFile), 'utf8');
fs.writeFileSync(path.join(TARGET_DIR, 'index.md'), replaceLinks(introContent));
console.log(`Processed Intro: ${introFile} -> index.md`);

// Glossary
if (glossaryFile) {
  const glossaryContent = fs.readFileSync(path.join(SOURCE_DIR, glossaryFile), 'utf8');
  fs.writeFileSync(path.join(APPENDIX_DIR, 'glossary.md'), replaceLinks(glossaryContent));
}

// Other Appendix
appendixFiles.forEach(file => {
  const content = fs.readFileSync(path.join(SOURCE_DIR, file), 'utf8');
  const targetPath = path.join(APPENDIX_DIR, fileMapping[file].split('/').pop() + '.md');
  fs.writeFileSync(targetPath, replaceLinks(content));
});

// Copy Demo
const demoSource = path.join(__dirname, '../protected.md');
if (fs.existsSync(demoSource)) {
  fs.copyFileSync(demoSource, path.join(TARGET_DIR, 'protected.md'));
}

// Copy the new Rev 8 dedicated track demo pages (they live alongside protected.md)
const trackDemoSources = [
  path.join(__dirname, '../demo-track-a.md'),
  path.join(__dirname, '../demo-track-b.md'),
];
trackDemoSources.forEach(src => {
  const base = path.basename(src);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(TARGET_DIR, base));
  }
});
