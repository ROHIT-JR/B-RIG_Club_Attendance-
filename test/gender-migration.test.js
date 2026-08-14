'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const source = ['Config.js', 'Database.js', 'Code.js']
  .map(file => fs.readFileSync(file, 'utf8'))
  .join('\n');

const BASE_HEADERS = [
  'Student ID', 'Roll Number', 'Full Name', 'Status', 'Registered At',
  'Created By', 'Notes', 'Official Email'
];

function makeSheet(rows, events, id = 101) {
  const values = rows.map(row => row.slice());
  const formulas = rows.map(row => row.map(value =>
    typeof value === 'string' && value.startsWith('=') ? value : ''
  ));
  return {
    values,
    formulas,
    getSheetId: () => id,
    getLastRow: () => values.length,
    getLastColumn: () => Math.max(0, ...values.map(row => row.length)),
    getMaxColumns: () => 26,
    insertColumnAfter() { events.push('insert-column'); },
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValues: () => Array.from({ length: rowCount }, (_, rowOffset) =>
          Array.from({ length: columnCount }, (_, columnOffset) =>
            values[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? ''
          )
        ),
        getFormulas: () => Array.from({ length: rowCount }, (_, rowOffset) =>
          Array.from({ length: columnCount }, (_, columnOffset) =>
            formulas[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? ''
          )
        ),
        setValue(value) {
          events.push(`write:${row}:${column}:${value}`);
          while (values.length < row) values.push([]);
          while (values[row - 1].length < column) values[row - 1].push('');
          values[row - 1][column - 1] = value;
          return this;
        },
        setFontWeight() { return this; }
      };
    }
  };
}

function makeSpreadsheet(rows, events, id = 'SS-1', name = 'Attendance', options = {}) {
  const sheet = makeSheet(rows, events);
  return {
    sheet,
    getId: () => id,
    getName: () => name,
    getUrl: () => `https://docs.google.com/spreadsheets/d/${id}`,
    getSheetByName: sheetName => sheetName === 'Students' ? sheet : null,
    copy(copyName) {
      events.push('backup');
      if (options.onCopy) options.onCopy(sheet);
      return makeSpreadsheet(options.backupRows || sheet.values, events, 'BACKUP-1', copyName);
    }
  };
}

function createHarness(rows, options = {}) {
  const events = [];
  const spreadsheet = makeSpreadsheet(rows, events, 'SS-1', 'Attendance', options);
  const context = vm.createContext({
    console: { error() {} },
    SpreadsheetApp: { flush: () => events.push('flush') },
    LockService: {
      getScriptLock: () => ({
        waitLock() { events.push('lock'); },
        releaseLock() { events.push('unlock'); }
      })
    },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      DigestAlgorithm: { SHA_256: 'SHA-256' },
      formatDate: () => '20260814-120000',
      computeDigest: (algorithm, value) => [...crypto.createHash('sha256').update(value).digest()]
    },
    Date,
    Map,
    Set
  });
  vm.runInContext(source, context);
  context.getAttendanceSpreadsheet = () => spreadsheet;
  context.getSetting = () => 'UTC';
  return {
    context,
    events,
    spreadsheet,
    call(name, ...args) {
      context.__args = args;
      return vm.runInContext(`${name}(...__args)`, context);
    }
  };
}

test('Gender migration dry run is additive and reports legacy rows without writes', () => {
  const harness = createHarness([
    BASE_HEADERS,
    ['STU-1', 'CB.SC.U4CYS25001', 'Student', 'Active', 'date', 'System', '', 'student@example.test']
  ]);
  const report = harness.call('DB.inspectStudentGenderSchema', harness.spreadsheet);
  assert.equal(report.status, 'ready');
  assert.equal(report.proposedGenderColumn, 9);
  assert.equal(report.rowsWithoutGender, 1);
  assert.equal(report.rowsWithGender, 0);
  assert.deepEqual(harness.events, []);
});

test('Gender migration creates and verifies backup before one header write and is idempotent', () => {
  const harness = createHarness([
    BASE_HEADERS,
    ['STU-1', 'CB.SC.U4CYS25001', 'Student', 'Active', 'date', 'System', '=A1', 'student@example.test']
  ]);
  const beforeRows = JSON.stringify(harness.spreadsheet.sheet.values);
  const result = harness.call('applyGenderSchemaMigration_');
  assert.equal(result.verified, true);
  assert.equal(result.backupId, 'BACKUP-1');
  assert.deepEqual(harness.events, ['lock', 'backup', 'write:1:9:Gender', 'flush', 'unlock']);
  assert.equal(harness.spreadsheet.sheet.values[0][8], 'Gender');
  assert.equal(JSON.stringify(harness.spreadsheet.sheet.values.map(row => row.slice(0, 8))), beforeRows);

  harness.events.length = 0;
  const second = harness.call('applyGenderSchemaMigration_');
  assert.equal(second.noOp, true);
  assert.deepEqual(harness.events, ['lock', 'unlock']);
});

test('Gender migration blocks normalized duplicate headers, invalid values, and duplicate keys', () => {
  for (const rows of [
    [[...BASE_HEADERS, ' gender ']],
    [[...BASE_HEADERS, 'Gender'], ['STU-1', 'CB.SC.U4CYS25001', 'A', 'Active', '', '', '', '', 'Other']],
    [[...BASE_HEADERS, 'Gender'], ['STU-1', 'CB.SC.U4CYS25001', 'A', 'Active', '', '', '', '', 'male']],
    [[...BASE_HEADERS, 'Gender'], ['STU-1', 'CB.SC.U4CYS25001', 'A', 'Active', '', '', '', '', ' Male ']],
    [BASE_HEADERS, ['STU-1', 'CB.SC.U4CYS25001'], ['STU-2', ' cb.sc.u4cys25001 ']]
  ]) {
    const harness = createHarness(rows);
    const report = harness.call('DB.inspectStudentGenderSchema', harness.spreadsheet);
    assert.equal(report.status, 'blocked');
    assert.equal(report.canApply, false);
    assert.deepEqual(harness.events, []);
  }
});

test('backup mismatch aborts before the original header is written', () => {
  const rows = [BASE_HEADERS, ['STU-1', 'CB.SC.U4CYS25001', 'Student']];
  const mismatched = [BASE_HEADERS, ['STU-1', 'CB.SC.U4CYS25001', 'Changed']];
  const harness = createHarness(rows, { backupRows: mismatched });
  assert.throws(() => harness.call('applyGenderSchemaMigration_'), /Backup verification failed/);
  assert.deepEqual(harness.events, ['lock', 'backup', 'unlock']);
  assert.equal(harness.spreadsheet.sheet.values[0].includes('Gender'), false);
});
