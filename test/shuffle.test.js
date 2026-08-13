'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const shuffleSource = fs.readFileSync('Shuffle.js', 'utf8');

function createHarness(overrides = {}) {
  const context = vm.createContext({
    console: { error() {} },
    CONFIG: { SHEETS: { STUDENTS: 'Students' } },
    SpreadsheetApp: overrides.SpreadsheetApp || {},
    LockService: overrides.LockService || {},
    Utilities: overrides.Utilities || {
      formatDate(date, timeZone, format) {
        if (format === 'yyyy-MM-dd') return date.toISOString().slice(0, 10);
        return date.toISOString();
      }
    },
    getAttendanceSpreadsheet: overrides.getAttendanceSpreadsheet || (() => overrides.spreadsheet),
    getSetting: overrides.getSetting || (() => 'UTC'),
    Math,
    Date,
    Map,
    Set
  });
  vm.runInContext(shuffleSource, context);
  return {
    context,
    call(name, ...args) {
      context.__args = args;
      return vm.runInContext(`${name}(...__args)`, context);
    }
  };
}

function deterministicRandom(seed = 123456789) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeStudents(departments) {
  return departments.map((department, index) => ({
    rollNumber: `CB.SC.U4${department}25${String(index + 1).padStart(3, '0')}`,
    fullName: `Student ${index + 1}`,
    department
  }));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('menu adds only the Shuffle command', () => {
  const code = fs.readFileSync('Code.js', 'utf8');
  assert.match(code, /\.addItem\('Shuffle', 'shuffleStudentsIntoGroups'\)/);
});

test('eligible students are active, complete, and deduplicated by normalized roll', () => {
  const rows = [
    ['Student ID', 'Roll Number', 'Full Name', 'Status'],
    ['1', ' cb.sc.u4cys25048 ', 'Active Student', 'active'],
    ['2', 'CB.SC.U4CYS25048', 'Duplicate Student', 'Active'],
    ['3', 'CB.SC.U4ECE25049', 'Pending Student', 'Pending'],
    ['4', 'CB.SC.U4EEE25050', 'Inactive Student', 'Inactive'],
    ['5', '', 'Missing Roll', 'Active'],
    ['6', 'CB.SC.U4MEC25051', '', 'Active'],
    ['', '', '', '']
  ];
  const spreadsheet = {
    getSheetByName: name => name === 'Students'
      ? { getDataRange: () => ({ getValues: () => rows }) }
      : null
  };
  const harness = createHarness({ spreadsheet });
  const students = plain(harness.call('getEligibleShuffleStudents_', spreadsheet));
  assert.deepEqual(students, [{
    rollNumber: 'CB.SC.U4CYS25048',
    fullName: 'Active Student',
    department: 'CYS'
  }]);
});

test('missing Status includes complete rows while missing required headers fails', () => {
  const withoutStatus = {
    getSheetByName: () => ({
      getDataRange: () => ({ getValues: () => [
        ['Roll Number', 'Full Name'],
        ['CB.SC.U4ECE25001', 'Student']
      ] })
    })
  };
  const harness = createHarness({ spreadsheet: withoutStatus });
  assert.equal(harness.call('getEligibleShuffleStudents_', withoutStatus).length, 1);

  const badHeaders = {
    getSheetByName: () => ({ getDataRange: () => ({ getValues: () => [['Name', 'Roll']] }) })
  };
  assert.throws(() => harness.call('getEligibleShuffleStudents_', badHeaders), /must contain/i);
});

test('department extraction uses the final three programme letters and falls back to UNK', () => {
  const harness = createHarness();
  assert.equal(harness.call('extractDepartmentFromRoll_', 'CB.SC.U4CYS25048'), 'CYS');
  assert.equal(harness.call('extractDepartmentFromRoll_', 'cb.en.pgdata25abc'), 'UNK');
  assert.equal(harness.call('extractDepartmentFromRoll_', 'CB.EN.U4ECE25001'), 'ECE');
  assert.equal(harness.call('extractDepartmentFromRoll_', 'CB.SC.MTECH25001'), 'ECH');
  assert.equal(harness.call('extractDepartmentFromRoll_', 'malformed'), 'UNK');
});

test('balanced capacities match required distributions and randomize extra seats', () => {
  const harness = createHarness();
  for (const [students, groups, expected] of [
    [10, 2, [5, 5]],
    [10, 3, [4, 3, 3]],
    [11, 3, [4, 4, 3]],
    [17, 4, [5, 4, 4, 4]]
  ]) {
    const capacities = [...harness.call('buildGroupCapacities_', students, groups, deterministicRandom(students + groups))].sort((a, b) => b - a);
    assert.deepEqual(capacities, expected);
  }
});

test('every student is assigned exactly once with balanced group sizes', () => {
  const harness = createHarness();
  const students = makeStudents(['CYS', 'ECE', 'EEE', 'MEC', 'CYS', 'ECE', 'EEE', 'MEC', 'CYS', 'ECE', 'EEE']);
  const groups = harness.call('buildInterdisciplinaryGroups_', students, 3, new Map(), new Set(), deterministicRandom());
  assert.equal(harness.call('validateGeneratedGroups_', groups, students), true);
  const sizes = groups.map(group => group.students.length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
});

test('same-department students occupy distinct groups whenever feasible', () => {
  const harness = createHarness();
  for (const count of [3, 5]) {
    const students = makeStudents(Array(count).fill('ECE'));
    const groups = harness.call('buildInterdisciplinaryGroups_', students, 5, new Map(), new Set(), deterministicRandom(count));
    const distribution = groups.map(group => group.students.filter(student => student.department === 'ECE').length);
    assert.equal(distribution.filter(value => value === 1).length, count);
    assert.equal(Math.max(...distribution), 1);
  }
});

test('dominant departments are spread optimally across groups', () => {
  const harness = createHarness();
  const students = makeStudents(Array(20).fill('CYS'));
  const groups = harness.call('buildInterdisciplinaryGroups_', students, 5, new Map(), new Set(), deterministicRandom());
  assert.deepEqual([...groups.map(group => group.students.length)].sort(), [4, 4, 4, 4, 4]);

  const twentyTwo = makeStudents(Array(22).fill('CYS'));
  const largerGroups = harness.call('buildInterdisciplinaryGroups_', twentyTwo, 5, new Map(), new Set(), deterministicRandom(42));
  assert.deepEqual([...largerGroups.map(group => group.students.length)].sort((a, b) => b - a), [5, 5, 4, 4, 4]);
});

test('recent teammate repeats are avoided when an equivalent alternative exists', () => {
  const harness = createHarness();
  const [a, b, c, d] = makeStudents(['CYS', 'ECE', 'EEE', 'MEC']);
  const recentPairs = new Set([harness.call('shufflePairKey_', a.rollNumber, b.rollNumber)]);
  const groups = harness.call('buildInterdisciplinaryGroups_', [a, b, c, d], 2, new Map(), recentPairs, deterministicRandom(7));
  const groupWithA = groups.find(group => group.students.some(student => student.rollNumber === a.rollNumber));
  assert.equal(groupWithA.students.some(student => student.rollNumber === b.rollNumber), false);
});

test('historical pair counts influence placement and impossible repeats still generate groups', () => {
  const harness = createHarness();
  const [a, b, c, d] = makeStudents(['CYS', 'ECE', 'EEE', 'MEC']);
  const pairCounts = new Map([[harness.call('shufflePairKey_', a.rollNumber, b.rollNumber), 10]]);
  const groups = harness.call('buildInterdisciplinaryGroups_', [a, b, c, d], 2, pairCounts, new Set(), deterministicRandom(99));
  const groupWithA = groups.find(group => group.students.some(student => student.rollNumber === a.rollNumber));
  assert.equal(groupWithA.students.some(student => student.rollNumber === b.rollNumber), false);

  const unavoidable = makeStudents(['CYS', 'ECE', 'EEE']);
  const allPairs = new Set();
  for (let first = 0; first < unavoidable.length; first++) {
    for (let second = first + 1; second < unavoidable.length; second++) {
      allPairs.add(harness.call('shufflePairKey_', unavoidable[first].rollNumber, unavoidable[second].rollNumber));
    }
  }
  const oneGroup = harness.call('buildInterdisciplinaryGroups_', unavoidable, 1, new Map(), allPairs, deterministicRandom());
  assert.equal(oneGroup[0].students.length, 3);
});

test('score comparison preserves department, recent, then historical priority', () => {
  const harness = createHarness();
  assert.ok(harness.call('compareShuffleScores_', [1, 0, 0], [0, 1000000, 1000000]) > 0);
  assert.ok(harness.call('compareShuffleScores_', [0, 1, 0], [0, 0, 1000000]) > 0);
  assert.ok(harness.call('compareShuffleScores_', [0, 0, 2], [0, 0, 3]) < 0);
  assert.equal(harness.call('compareShuffleScores_', [0, 0, 2], [0, 0, 2]), 0);
});

test('rewriting Shuffle breaks existing merged ranges before clearing', () => {
  const harness = createHarness();
  const calls = [];
  const chain = {
    setValues() { calls.push('setValues'); return this; },
    merge() { return this; },
    setFontWeight() { return this; },
    setFontSize() { return this; },
    setBackground() { return this; },
    setFontColor() { return this; },
    setHorizontalAlignment() { return this; },
    setFontStyle() { return this; },
    setVerticalAlignment() { return this; },
    setWrap() { return this; },
    setBorder() { return this; }
  };
  const sheet = {
    getLastRow: () => 8,
    getLastColumn: () => 4,
    getDataRange: () => ({ breakApart() { calls.push('breakApart'); } }),
    clear() { calls.push('clear'); },
    getRange: () => chain,
    setFrozenRows() {},
    setColumnWidth() {}
  };
  const groups = [{ number: 1, students: makeStudents(['CYS', 'ECE']) }];
  harness.call('writeShuffleSheet_', sheet, groups, '2026-08-10', new Date(), 'UTC', 2);
  assert.deepEqual(calls.slice(0, 3), ['breakApart', 'clear', 'setValues']);
});

test('failed history write restores exact existing Shuffle and history sheets', () => {
  const harness = createHarness();
  const deleted = [];
  const makeSheet = name => ({
    name,
    hidden: false,
    isSheetHidden() { return this.hidden; },
    copyTo() {
      const copy = makeSheet(`${this.name} copy`);
      allSheets.push(copy);
      return copy;
    },
    setName(value) { this.name = value; return this; },
    hideSheet() { this.hidden = true; return this; },
    showSheet() { this.hidden = false; return this; },
    getLastRow: () => 1,
    getLastColumn: () => 4,
    getDataRange: () => ({ breakApart() {}, getValues: () => [['Week Key']] }),
    clear() {},
    clearContents() {},
    getRange() {
      const sheet = this;
      return {
        setValues() {
          if (sheet.name === 'Shuffle History') throw new Error('history failed');
          return this;
        },
        merge() { return this; },
        setFontWeight() { return this; },
        setFontSize() { return this; },
        setBackground() { return this; },
        setFontColor() { return this; },
        setHorizontalAlignment() { return this; },
        setVerticalAlignment() { return this; },
        setFontStyle() { return this; },
        setWrap() { return this; },
        setBorder() { return this; }
      };
    },
    setFrozenRows() {},
    setColumnWidth() {}
  });
  let shuffle = makeSheet('Shuffle');
  let history = makeSheet('Shuffle History');
  const allSheets = [shuffle, history];
  const spreadsheet = {
    getSheetByName(name) { return allSheets.find(sheet => sheet.name === name) || null; },
    deleteSheet(sheet) { deleted.push(sheet.name); allSheets.splice(allSheets.indexOf(sheet), 1); },
    insertSheet(name) { const sheet = makeSheet(name); allSheets.push(sheet); return sheet; },
    setActiveSheet() {}
  };
  const groups = [{ number: 1, students: makeStudents(['CYS']) }];

  assert.throws(() => harness.call(
    'writeShuffleResultsSafely_', spreadsheet, [], groups, '2026-08-10', new Date(), 'UTC', 1
  ), /history failed/);
  assert.ok(deleted.includes('Shuffle'));
  assert.ok(deleted.includes('Shuffle History'));
  assert.ok(spreadsheet.getSheetByName('Shuffle'));
  assert.ok(spreadsheet.getSheetByName('Shuffle History'));
});

test('failed first-run history write removes newly created feature sheets', () => {
  const harness = createHarness();
  const allSheets = [];
  const makeSheet = name => ({
    name,
    isSheetHidden: () => false,
    getLastRow: () => name === 'Shuffle History' ? 0 : 1,
    getLastColumn: () => 4,
    getDataRange: () => ({ breakApart() {} }),
    clear() {},
    clearContents() {},
    getRange() {
      const sheet = this;
      return {
        setValues() {
          if (sheet.name === 'Shuffle History') throw new Error('history failed');
          return this;
        },
        merge() { return this; },
        setFontWeight() { return this; },
        setFontSize() { return this; },
        setBackground() { return this; },
        setFontColor() { return this; },
        setHorizontalAlignment() { return this; },
        setVerticalAlignment() { return this; },
        setFontStyle() { return this; },
        setWrap() { return this; },
        setBorder() { return this; }
      };
    },
    setFrozenRows() {},
    setColumnWidth() {}
  });
  const spreadsheet = {
    getSheetByName(name) { return allSheets.find(sheet => sheet.name === name) || null; },
    insertSheet(name) { const sheet = makeSheet(name); allSheets.push(sheet); return sheet; },
    deleteSheet(sheet) { allSheets.splice(allSheets.indexOf(sheet), 1); },
    setActiveSheet() {}
  };

  assert.throws(() => harness.call(
    'writeShuffleResultsSafely_', spreadsheet, [],
    [{ number: 1, students: makeStudents(['CYS']) }],
    '2026-08-10', new Date(), 'UTC', 1
  ), /history failed/);
  assert.equal(spreadsheet.getSheetByName('Shuffle'), null);
  assert.equal(spreadsheet.getSheetByName('Shuffle History'), null);
});

test('week key uses Monday and current-week history is excluded from pair penalties', () => {
  const harness = createHarness();
  assert.equal(harness.call('getWeekKey_', new Date('2026-08-13T12:00:00Z'), 'UTC'), '2026-08-10');
  assert.equal(harness.call('getWeekKey_', new Date('2026-08-16T12:00:00Z'), 'UTC'), '2026-08-10');
  assert.equal(harness.call('getWeekKey_', new Date('2026-08-17T12:00:00Z'), 'UTC'), '2026-08-17');

  const rows = [
    { weekKey: '2026-08-03', groupNumber: 1, rollNumber: 'A' },
    { weekKey: '2026-08-03', groupNumber: 1, rollNumber: 'B' },
    { weekKey: '2026-08-10', groupNumber: 1, rollNumber: 'A' },
    { weekKey: '2026-08-10', groupNumber: 1, rollNumber: 'C' }
  ];
  const history = harness.call('buildPairHistory_', rows, '2026-08-10');
  assert.equal(history.pairCounts.get('A\u0000B'), 1);
  assert.equal(history.pairCounts.has('A\u0000C'), false);
  assert.equal(history.recentPairs.has('A\u0000B'), true);
});

test('same-week history replacement retains older weeks and writes one official arrangement', () => {
  const harness = createHarness();
  const existing = [
    { weekKey: '2026-08-03', generatedAt: 'old', groupNumber: 1, rollNumber: 'A', fullName: 'A', department: 'CYS' },
    { weekKey: '2026-08-10', generatedAt: 'current-old', groupNumber: 1, rollNumber: 'B', fullName: 'B', department: 'ECE' }
  ];
  let written;
  const sheet = {
    clearContents() {},
    getRange() {
      return {
        setValues(values) { written = values; return this; },
        setFontWeight() { return this; }
      };
    },
    setFrozenRows() {}
  };
  const groups = [{ number: 1, students: [{ rollNumber: 'C', fullName: 'C', department: 'EEE' }] }];
  harness.call('replaceCurrentWeekHistory_', sheet, existing, '2026-08-10', new Date(), groups);
  assert.equal(written.filter(row => row[0] === '2026-08-03').length, 1);
  assert.equal(written.filter(row => row[0] === '2026-08-10').length, 1);
  assert.equal(written.find(row => row[0] === '2026-08-10')[3], 'C');
});

test('cancel, invalid count, missing Students, and invalid headers do not touch output sheets', () => {
  for (const scenario of ['cancel', 'invalid', 'missing', 'headers']) {
    let outputTouches = 0;
    const rows = scenario === 'headers'
      ? [['Wrong', 'Headers'], ['x', 'y']]
      : [['Roll Number', 'Full Name', 'Status'], ['CB.SC.U4CYS25001', 'Student', 'Active']];
    const spreadsheet = {
      getSheetByName(name) {
        if (name === 'Students') {
          if (scenario === 'missing') return null;
          return { getDataRange: () => ({ getValues: () => rows }) };
        }
        outputTouches += 1;
        return null;
      },
      insertSheet() { outputTouches += 1; },
      toast() { outputTouches += 1; }
    };
    const alerts = [];
    const ui = {
      Button: { OK: 'OK' },
      ButtonSet: { OK_CANCEL: 'OK_CANCEL' },
      prompt: () => ({
        getSelectedButton: () => scenario === 'cancel' ? 'CANCEL' : 'OK',
        getResponseText: () => scenario === 'invalid' ? '0' : '1'
      }),
      alert: message => alerts.push(message)
    };
    const harness = createHarness({
      spreadsheet,
      SpreadsheetApp: { getUi: () => ui }
    });
    harness.call('shuffleStudentsIntoGroups');
    assert.equal(outputTouches, 0, scenario);
  }
});

test('add-only boundary leaves protected attendance and Vercel files byte-identical to main', () => {
  const expectedHashes = {
    'Config.js': '23bb1a55678caeef66e7d39f9b58e0752ef75a67ca1641591a4af8a3074d0932',
    'Database.js': '5fdb44a58666e9f2b26adf519842dcf104eb2333c7bc35152346133235ef38de',
    'AdminSidebar.html': '601d56dc2985cefd173545ca047f6526d53fd15e54a6efcbab03c626ea21788e',
    'appsscript.json': '7ac9773a041fa8c532a9102a881594471de56af49720e3cbfb619a7272dbc793',
    'vercel/index.html': 'f0b0ed4c45c1ed75af0742faf13f4baa288696e9e6f8a4d2a119c314259e1205',
    'vercel/app.js': 'eeb6a5d75c7246c634181c99e6a9ca04bd53b7422d8fd2531b6741de2bdb786e',
    'vercel/styles.css': '668f93d98afd21292340c16b2d3ff676288f9bc6d27a398b1d79f29c00b87b01',
    'vercel/api/attendance.js': '0d41015718fe233a8bf3cd1c2a6dd42fc64b5071d7bfdaf7afef4086e6410c2d',
    'vercel/vercel.json': 'f036dcc45aacfa11311008f5c3c36e51b2b2928f680d69602e2b8dff5b930b82',
    'vercel/package.json': '67823a4444364bbec1e7bbba1aa14aeaf756250c5d42bc73419510c16e2a66be',
    'vercel/package-lock.json': '9698f1b8376b0ad130fd08f75dc0feb79393de2f64be78fa4bc87e5cfcf0f12a',
    'vercel/.env.example': '311ec6d2ee8a45bf056ca0cda447b9884115a32a2d7b9ea5ec8bf85ef7fa233a',
    'vercel/test/attendance.test.js': 'cfa79b917cfc29983dae8efbe30e1de517ea52973bafb57809d3a2869dbd60a5'
  };
  for (const [path, expectedHash] of Object.entries(expectedHashes)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
    assert.equal(actual, expectedHash, `${path} changed outside the allowed boundary`);
  }
});
