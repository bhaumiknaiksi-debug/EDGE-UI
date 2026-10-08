import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const content=await readFile('web-push.js','utf8');
assert.ok(content.includes('serverRegistered'));
assert.ok(content.includes('els.test.hidden = !subscription || !serverRegistered'));
console.log('Push registration check passed');
