const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// `--unpacked` assembles the folder without zipping and leaves it in place, for
// Claude Desktop's "Install Unpacked Extension" flow.
const unpacked = process.argv.includes('--unpacked');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const buildDir = path.join(root, 'mcpb-build');
const outFile = path.join(root, 'yazio-mcp.mcpb');
const outZip = path.join(root, 'yazio-mcp.zip');

// The bundled entrypoint must exist — `npm run build` produces it.
if (!fs.existsSync(path.join(distDir, 'index.js'))) {
  console.error('❌ dist/index.js not found. Run `npm run build` first.');
  process.exit(1);
}

// Assemble the layout the manifest references: server/<dist> + manifest.json + package.json.
// Dependencies are bundled into dist/index.js, so no node_modules are vendored here.
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(path.join(buildDir, 'server'), { recursive: true });
fs.cpSync(distDir, path.join(buildDir, 'server'), { recursive: true });
for (const file of ['manifest.json', 'package.json']) {
  fs.copyFileSync(path.join(root, file), path.join(buildDir, file));
}

if (unpacked) {
  console.log(`✅ Built unpacked extension at ${path.relative(root, buildDir)}/`);
  console.log('   Claude Desktop → Settings → Extensions → Advanced → Install Unpacked Extension → pick this folder.');
  return;
}

// Pack with the locally-installed mcpb CLI (@anthropic-ai/mcpb devDependency).
execFileSync('npx', ['--no-install', 'mcpb', 'pack', buildDir, outFile], {
  stdio: 'inherit',
});

// Also produce a plain .zip of the same layout for the "Install Unpacked
// Extension" workaround (see mcpb#281). Zip from inside buildDir so paths are
// relative (manifest.json at the root).
fs.rmSync(outZip, { force: true });
execFileSync('zip', ['-r', '-q', outZip, '.'], { cwd: buildDir });

// Clean up the transient build directory.
fs.rmSync(buildDir, { recursive: true, force: true });

console.log(`✅ Packed ${path.relative(root, outFile)} and ${path.relative(root, outZip)}`);
