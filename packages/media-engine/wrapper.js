const { existsSync } = require('fs');
const { join } = require('path');

const platforms = [
  'media-engine.win32-x64-msvc.node',
];

let nativeBinding = null;

for (const platform of platforms) {
  const path = join(__dirname, platform);
  if (existsSync(path)) {
    nativeBinding = require(path);
    break;
  }
}

if (!nativeBinding) {
  throw new Error('Failed to load native binding. Run `pnpm build` first.');
}

module.exports = nativeBinding;
