const assert = require('assert');

// Utility function to strip ASCII control characters (0x00-0x1F and 0x7F)
function stripControlChars(str) {
    if (typeof str !== 'string') return str;
    // Retains standard printable characters, newlines (\n), tabs (\t), and carriage returns (\r)
    return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

console.log('Running test: 096-strip-control-chars...');

// 1. Test basic control character removal (e.g. \x00 Null byte, \x07 Bell)
const inputWithNull = 'Hello\x00World\x07!';
const expectedClean = 'HelloWorld!';
assert.strictEqual(stripControlChars(inputWithNull), expectedClean, 'Should strip NULL and Bell control characters');

// 2. Test preservation of allowed whitespace (Tabs, Newlines, Carriage Returns)
const inputWithWhitespace = 'Line 1\nLine 2\tTabbed\r\n';
assert.strictEqual(stripControlChars(inputWithWhitespace), inputWithWhitespace, 'Should preserve \\n, \\t, and \\r');

// 3. Test non-string input handling
assert.strictEqual(stripControlChars(12345), 12345, 'Should return non-string input untouched');
assert.strictEqual(stripControlChars(null), null, 'Should return null untouched');

console.log('Test 096-strip-control-chars passed successfully!');