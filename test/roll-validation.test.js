'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const configSource = fs.readFileSync('Config.js', 'utf8');
const frontendSource = fs.readFileSync('vercel/app.js', 'utf8');

const fixtures = {
  valid: [
    'CB.SC.U4CYS25048',
    'CB.EN.U4EEE25048',
    'cb.en.u4eee25048',
    'CB.XY.PG2026.001',
    'CB.A1.B2C3'
  ],
  invalid: [
    '',
    'CB.A',
    `CB.${'A'.repeat(30)}`,
    'CB.EN U4EEE25048',
    'CB/EN/U4EEE25048',
    'CB.EN@U4EEE25048',
    'CB.EN#U4EEE25048',
    'CB.EN,U4EEE25048',
    'CB..U4EEE25048',
    'CB.EN.U4EEE25048.',
    'XX.EN.U4EEE25048',
    `CB.EN.${String.fromCharCode(7)}U4EEE25048`
  ]
};

function createServerValidator() {
  const context = vm.createContext({});
  vm.runInContext(configSource, context);
  return {
    validate(value) {
      context.__value = value;
      return vm.runInContext('isValidRollNo(__value)', context);
    },
    email(value) {
      context.__value = value;
      return vm.runInContext('getOfficialEmailForRollNo(__value)', context);
    }
  };
}

function createFrontendValidator() {
  const declarations = [
    'ROLL_NUMBER_PATTERN', 'ROLL_NUMBER_MIN_LENGTH', 'ROLL_NUMBER_MAX_LENGTH'
  ].map(name => frontendSource.match(new RegExp(`const ${name} = [^;]+;`))[0]).join('\n');
  const normalizeFunction = frontendSource.match(/function normalizeRollNumber\(value\) \{[\s\S]*?\n  \}/)[0];
  const validateFunction = frontendSource.match(/function isValidRollNumber\(value\) \{[\s\S]*?\n  \}/)[0];
  const context = vm.createContext({});
  vm.runInContext(`${declarations}\n${normalizeFunction}\n${validateFunction}`, context);
  return value => {
    context.__value = value;
    return vm.runInContext('isValidRollNumber(__value)', context);
  };
}

test('Apps Script and frontend accept the same generalized CB roll fixtures', () => {
  const server = createServerValidator();
  const frontend = createFrontendValidator();
  for (const value of fixtures.valid) {
    assert.equal(server.validate(value), true, `server rejected ${value}`);
    assert.equal(frontend(value), true, `frontend rejected ${value}`);
  }
  for (const value of fixtures.invalid) {
    assert.equal(server.validate(value), false, `server accepted ${JSON.stringify(value)}`);
    assert.equal(frontend(value), false, `frontend accepted ${JSON.stringify(value)}`);
  }
});

test('official email is derived from the generalized normalized roll', () => {
  const server = createServerValidator();
  assert.equal(
    server.email(' cb.en.u4eee25048 '),
    'cb.en.u4eee25048@cb.students.amrita.edu'
  );
});

test('student UI uses neutral roll guidance and the 32-character limit', () => {
  const html = fs.readFileSync('vercel/index.html', 'utf8');
  assert.match(html, /placeholder="CB\.EN\.U4EEE25048"/);
  assert.match(html, /maxlength="32"/);
  assert.match(html, /complete university roll number exactly as issued/i);
  assert.doesNotMatch(html, /CB\.SC\.U4<\/b>|CYS<\/b> department/);
  assert.doesNotMatch(frontendSource, /Use CB\.SC\.U4CYS25048 format|slice\(0, 16\)/);
});
