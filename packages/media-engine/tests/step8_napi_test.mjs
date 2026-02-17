import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const engine = require('../wrapper.js');

console.log('=== NAPI Binding Tests ===\n');

// Test 1: version()
const ver = engine.version();
console.log(`version(): "${ver}"`);
if (typeof ver !== 'string' || !ver.match(/^\d+\.\d+\.\d+$/)) {
  throw new Error(`Expected semver string, got: ${ver}`);
}
console.log('  PASS\n');

// Test 2: listDisplays()
const displays = engine.listDisplays();
console.log(`listDisplays(): ${displays.length} display(s)`);
for (const d of displays) {
  console.log(`  [${d.index}] "${d.name}" ${d.width}x${d.height}`);
}
if (!Array.isArray(displays) || displays.length === 0) {
  throw new Error('Expected at least one display');
}
const d = displays[0];
if (typeof d.index !== 'number' || typeof d.name !== 'string' || typeof d.width !== 'number') {
  throw new Error('Display info has wrong shape');
}
console.log('  PASS\n');

// Test 3: listWindows()
const windows = engine.listWindows();
console.log(`listWindows(): ${windows.length} window(s)`);
for (const w of windows.slice(0, 5)) {
  console.log(`  [${w.handle}] "${w.title}" (${w.processName})`);
}
if (windows.length > 5) {
  console.log(`  ... and ${windows.length - 5} more`);
}
if (!Array.isArray(windows)) {
  throw new Error('Expected array of windows');
}
console.log('  PASS\n');

// Test 4: isScreenShareRunning() (should be false)
const running = engine.isScreenShareRunning();
console.log(`isScreenShareRunning(): ${running}`);
if (running !== false) {
  throw new Error('Expected false when no screen share is active');
}
console.log('  PASS\n');

// Test 5: stopScreenShare() should throw when not running
try {
  engine.stopScreenShare();
  throw new Error('Expected error from stopScreenShare');
} catch (e) {
  if (e.message.includes('No screen share running')) {
    console.log(`stopScreenShare() correctly throws: "${e.message}"`);
    console.log('  PASS\n');
  } else {
    throw e;
  }
}

// Test 6: forceKeyframe() should throw when not running
try {
  engine.forceKeyframe();
  throw new Error('Expected error from forceKeyframe');
} catch (e) {
  if (e.message.includes('No screen share running')) {
    console.log(`forceKeyframe() correctly throws: "${e.message}"`);
    console.log('  PASS\n');
  } else {
    throw e;
  }
}

console.log('=== All NAPI tests passed! ===');
