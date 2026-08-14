'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('student frontend is Vercel-only and has no Apps Script client dependency', () => {
  const frontend = [read('vercel/index.html'), read('vercel/app.js'), read('vercel/styles.css')].join('\n');

  assert.doesNotMatch(frontend, /google\.script\.run|script\.google\.com|<\?=|<\?!=|authuser/i);
  assert.match(frontend, /\/api\/attendance/);
  assert.match(frontend, /URLSearchParams/);
  assert.match(frontend, /brig_device_id/);
  assert.match(frontend, /prefers-reduced-motion/);
});

test('Apps Script keeps admin QR rotation and locked attendance writes', () => {
  const code = read('Code.js');
  const config = read('Config.js');
  const database = read('Database.js');
  const admin = read('AdminSidebar.html');

  assert.match(admin, /google\.script\.run/);
  assert.match(admin, /getRotatingQrData/);
  assert.match(admin, /integrity="sha384-/);
  assert.match(admin, /refreshWatchdog/);
  assert.match(code, /QR_LIFETIME_SECONDS \* 1000/);
  assert.match(code, /DB\.withLock/);
  assert.match(code, /function closeCurrentSession\(\)[\s\S]*?DB\.withLock/);
  assert.match(code, /function clearAllData\(\)[\s\S]*?DB\.withLock/);
  assert.match(code, /getCheckinByDevice/);
  assert.match(code, /hashDeviceId/);
  assert.match(code, /sanitizeSpreadsheetText_\(userAgent/);
  assert.match(code, /Official Email/);
  assert.match(code, /getOfficialEmailForRollNo/);
  assert.match(code, /getFormulas\(\)/);
  assert.match(config, /SPREADSHEET_ID/);
  assert.match(config, /SpreadsheetApp\.openById/);
  assert.match(config, /attendanceSpreadsheet_/);
  assert.doesNotMatch(code + database, /SpreadsheetApp\.getActiveSpreadsheet/);
  assert.doesNotMatch(code, /authuser|QR_REDIRECT_URL|github\.io\/.*qr\.html/);
});

test('obsolete Apps Script student and GitHub redirect pages are removed', () => {
  for (const path of ['Index.html', 'ClientScript.html', 'Styles.html', 'qr.html']) {
    assert.equal(fs.existsSync(path), false, `${path} should not exist`);
  }
});

test('Vercel environment example contains names only and secrets stay server-side', () => {
  const envExample = read('vercel/.env.example');
  const browserBundle = read('vercel/app.js');

  assert.equal(envExample, 'APPS_SCRIPT_URL=\nAPPS_SCRIPT_API_SECRET=\n');
  assert.doesNotMatch(browserBundle, /APPS_SCRIPT_URL|APPS_SCRIPT_API_SECRET|apiSecret/);
  assert.match(read('vercel/api/attendance.js'), /process\.env|apiSecret/);
});

test('Vercel configuration sets same-origin and browser security boundaries', () => {
  const config = JSON.parse(read('vercel/vercel.json'));
  const headers = Object.fromEntries(config.headers[0].headers.map(header => [header.key, header.value]));

  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.match(headers['Content-Security-Policy'], /connect-src 'self'/);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(config.functions['api/attendance.js'].maxDuration, 30);
});

test('Vercel proxy applies request limits and leaves enough time for Apps Script locking', () => {
  const proxy = read('vercel/api/attendance.js');
  const browser = read('vercel/app.js');

  assert.match(proxy, /DEFAULT_TIMEOUT_MS = 25_000/);
  assert.match(proxy, /consumeRateLimit/);
  assert.match(proxy, /Retry-After/);
  assert.match(proxy, /429/);
  assert.match(browser, /REQUEST_TIMEOUT_MS = 30000/);
  assert.match(browser, /configurationError/);
});

test('Gender collection is one-time, restricted to Male and Female, and server-authoritative', () => {
  const html = read('vercel/index.html');
  const browser = read('vercel/app.js');
  const proxy = read('vercel/api/attendance.js');
  const config = read('Config.js');
  const code = read('Code.js');

  assert.match(html, /id="confirm-gender-group"/);
  assert.match(html, /id="regGender"[^>]*required/);
  assert.ok(html.indexOf('value="Male"') < html.indexOf('value="Female"'));
  assert.doesNotMatch(html + browser + proxy + config, /Prefer not to say/);
  assert.match(browser, /genderRequired/);
  assert.match(proxy, /\['Male', 'Female'\]/);
  assert.match(code, /GENDER_REQUIRED/);
  assert.match(code, /studentsSheet\.getRange\(student\.row/);
});

test('Gender migration is explicit, locked, backed up, and preservation-verified', () => {
  const code = read('Code.js');
  const database = read('Database.js');
  assert.match(code, /dryRunGenderSchemaUpgrade/);
  assert.match(code, /applyGenderSchemaUpgrade/);
  assert.match(code, /DB\.withLock/);
  assert.match(code, /ss\.copy/);
  assert.match(code, /SpreadsheetApp\.flush/);
  assert.match(code, /preservedDigest/);
  assert.doesNotMatch(code, /DriveApp/);
  assert.match(database, /inspectStudentGenderSchema/);
});
