const fs = require('fs');
const { version } = require('../package.json');

function updateJsonFile(filePath, replacer) {
  const content = fs.readFileSync(filePath, 'utf8');
  fs.writeFileSync(filePath, replacer(content, version));
}

// manifest.json — single version field
updateJsonFile('manifest.json', (c, v) =>
  c.replace(/"version": "[^"]*"/, `"version": "${v}"`)
);

// server.json — two version fields (root + package)
updateJsonFile('server.json', (c, v) =>
  c.replace(/"version": "[^"]*"/g, `"version": "${v}"`)
);
