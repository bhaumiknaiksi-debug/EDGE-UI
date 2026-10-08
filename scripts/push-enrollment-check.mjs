import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const content=await readFile('web-push.js','utf8');
assert.ok(content.includes('serverRegistered'));
assert.ok(content.includes('els.test.hidden = !subscription || !serverRegistered'));
assert.ok(content.includes('confirmation.registered !== true'));
assert.ok(content.includes('error.status === 404'));
console.log('Push registration check passed');
