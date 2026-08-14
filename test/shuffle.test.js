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
    CONFIG: {
      SHEETS: {
        STUDENTS: 'Students',
        SESSIONS: 'Sessions',
        DASHBOARD: 'Attendance Dashboard'
      },
      MARKERS: { PRESENT: 'P' }
    },
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

function makeStudents(departments, newMemberCount = 0) {
  return departments.map((department, index) => ({
    rollNumber: `CB.SC.U4${department}25${String(index + 1).padStart(3, '0')}`,
    fullName: `Student ${index + 1}`,
    department,
    isNewMember: index < newMemberCount
  }));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('menu adds only the Shuffle command', () => {
  const code = fs.readFileSync('Code.js', 'utf8');
  assert.match(code, /\.addItem\('Shuffle', 'shuffleStudentsIntoGroups'\)/);
});

test('only latest-session P rows are eligible and present new members are included', () => {
  const dashboardRows = [
    ['S.No', 'Name', 'Roll No', '07-08-2026', '14-08-2026'],
    [1, 'Arun', 'CB.SC.U4CYS25001', 'P', 'P'],
    [2, 'Bala', 'CB.SC.U4ECE25002', 'P', 'A'],
    [3, 'Chris', 'CB.SC.U4EEE25003', 'A', 'P'],
    [4, 'Diya', 'CB.SC.U4MEC25004', 'P', 'P'],
    [5, 'Eshan', 'CB.SC.U4CSE25005', 'P', ''],
    [6, 'Duplicate', ' cb.sc.u4cys25001 ', 'A', 'P'],
    [7, 'Whitespace Mark', 'CB.SC.U4CYS25007', 'A', ' p ']
  ];
  const studentRows = [
    ['Roll Number', 'Registered At'],
    ['CB.SC.U4CYS25001', new Date('2026-08-01T08:00:00Z')],
    ['CB.SC.U4ECE25002', new Date('2026-08-01T08:00:00Z')],
    ['CB.SC.U4EEE25003', new Date('invalid')],
    ['CB.SC.U4MEC25004', new Date('2026-08-14T09:14:00Z')]
  ];
  const dashboard = {
    getDataRange: () => ({ getValues: () => dashboardRows }),
    getRange: () => ({ getNotes: () => [['', '', '', 'SES-OLD', 'SES-LATEST']] })
  };
  const spreadsheet = {
    getSheetByName(name) {
      if (name === 'Attendance Dashboard') return dashboard;
      if (name === 'Students') return { getDataRange: () => ({ getValues: () => studentRows }) };
      return null;
    }
  };
  const harness = createHarness({ spreadsheet });
  const session = { sessionId: 'SES-LATEST', date: new Date('2026-08-14T00:00:00Z') };
  const students = plain(harness.call('getEligibleShuffleStudents_', spreadsheet, session, 'UTC'));
  assert.deepEqual(students.map(student => [student.fullName, student.isNewMember]), [
    ['Arun', false],
    ['Chris', false],
    ['Diya', true]
  ]);
});

test('latest session is the final session row and never falls back to an older row', () => {
  const sessionRows = [
    ['Session ID', 'Session Date', 'Session Title'],
    ['SES-OLD', new Date('2026-08-07T00:00:00Z'), 'Old'],
    ['SES-LATEST', new Date('2026-08-14T00:00:00Z'), 'Latest']
  ];
  const spreadsheet = {
    getSheetByName: () => ({ getDataRange: () => ({ getValues: () => sessionRows }) })
  };
  const harness = createHarness({ spreadsheet });
  assert.equal(harness.call('getLatestAttendanceSession_', spreadsheet).sessionId, 'SES-LATEST');

  sessionRows[2][1] = 'invalid';
  assert.throws(() => harness.call('getLatestAttendanceSession_', spreadsheet), /latest attendance session date is invalid/i);

  sessionRows[2] = ['', new Date('2026-08-14T00:00:00Z'), 'Malformed latest'];
  assert.throws(() => harness.call('getLatestAttendanceSession_', spreadsheet), /latest attendance session is invalid/i);
});

test('dashboard matching requires the exact latest session ID note', () => {
  const harness = createHarness();
  const dashboard = {
    getRange: () => ({ getNotes: () => [['', '', '', 'SES-OLD', '']] })
  };
  const headers = ['S.No', 'Name', 'Roll No', '14-08-2026', '14-08-2026'];
  assert.throws(() => harness.call(
    'findLatestAttendanceColumn_', dashboard, headers,
    { sessionId: 'SES-LATEST', date: new Date('2026-08-14T00:00:00Z') }, 'UTC'
  ), /latest attendance session column was not found/i);
});

test('new-member classification compares calendar dates and treats invalid registration as existing', () => {
  const harness = createHarness();
  const sessionDate = new Date('2026-08-14T00:00:00Z');
  assert.equal(harness.call('isSameShuffleDate_', new Date('2026-08-14T08:00:00Z'), sessionDate, 'UTC'), true);
  assert.equal(harness.call('isSameShuffleDate_', new Date('2026-08-13T23:59:00Z'), sessionDate, 'UTC'), false);
  assert.equal(harness.call('isSameShuffleDate_', 'invalid', sessionDate, 'UTC'), false);
  assert.equal(harness.call('isSameShuffleDate_', '', sessionDate, 'UTC'), false);
});

test('new-member date comparison honors the configured time zone', () => {
  const harness = createHarness({
    Utilities: {
      formatDate(date, timeZone) {
        const offset = timeZone === 'Asia/Kolkata' ? 330 * 60 * 1000 : 0;
        return new Date(date.getTime() + offset).toISOString().slice(0, 10);
      }
    }
  });
  const registered = new Date('2026-08-14T18:00:00Z');
  const session = new Date('2026-08-14T20:00:00Z');
  assert.equal(harness.call('isSameShuffleDate_', registered, session, 'UTC'), true);
  assert.equal(harness.call('isSameShuffleDate_', registered, session, 'Asia/Kolkata'), false);
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

test('actual group count is the maximum of preferred-size and new-member requirements', () => {
  const harness = createHarness();
  assert.equal(harness.call('calculateShuffleGroupCount_', 20, 5, 2), 4);
  assert.equal(harness.call('calculateShuffleGroupCount_', 20, 5, 6), 6);
  assert.equal(harness.call('calculateShuffleGroupCount_', 18, 5, 5), 5);
  assert.equal(harness.call('calculateShuffleGroupCount_', 12, 5, 7), 7);
  assert.equal(harness.call('calculateShuffleGroupCount_', 5, 5, 5), 5);
});

test('preferred group strength prompt validates the administrator input', () => {
  const harness = createHarness();
  const alerts = [];
  const makeUi = value => ({
    Button: { OK: 'OK' },
    ButtonSet: { OK_CANCEL: 'OK_CANCEL' },
    prompt: (title, message) => {
      assert.equal(title, 'Shuffle Students');
      assert.equal(message, 'Enter the preferred number of students per group:');
      return { getSelectedButton: () => 'OK', getResponseText: () => value };
    },
    alert: message => alerts.push(message)
  });
  assert.equal(harness.call('promptForPreferredGroupSize_', 20, makeUi('5')), 5);
  assert.equal(harness.call('promptForPreferredGroupSize_', 20, makeUi('0')), null);
  assert.equal(harness.call('promptForPreferredGroupSize_', 20, makeUi('4.5')), null);
  const cancelUi = makeUi('5');
  cancelUi.prompt = () => ({ getSelectedButton: () => 'CANCEL', getResponseText: () => '5' });
  assert.equal(harness.call('promptForPreferredGroupSize_', 20, cancelUi), null);
  assert.equal(alerts.length, 2);
});

test('every student is assigned exactly once with balanced group sizes', () => {
  const harness = createHarness();
  const students = makeStudents(['CYS', 'ECE', 'EEE', 'MEC', 'CYS', 'ECE', 'EEE', 'MEC', 'CYS', 'ECE', 'EEE']);
  const groups = harness.call('buildInterdisciplinaryGroups_', students, 3, new Map(), new Set(), deterministicRandom());
  assert.equal(harness.call('validateGeneratedGroups_', groups, students), true);
  const sizes = groups.map(group => group.students.length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
});

test('new members are seeded into separate teams and can increase group count', () => {
  const harness = createHarness();
  const students = makeStudents([
    'CYS', 'CYS', 'ECE', 'EEE', 'MEC', 'CSE',
    'CYS', 'CYS', 'CYS', 'ECE', 'EEE', 'MEC', 'CSE', 'CYS', 'ECE', 'EEE', 'MEC', 'CSE', 'CYS', 'ECE'
  ], 6);
  const groupCount = harness.call('calculateShuffleGroupCount_', students.length, 5, 6);
  const groups = harness.call('buildInterdisciplinaryGroups_', students, groupCount, new Map(), new Set(), deterministicRandom(6));
  assert.equal(groupCount, 6);
  assert.deepEqual([...groups.map(group => group.students.length)].sort((a, b) => b - a), [4, 4, 3, 3, 3, 3]);
  assert.ok(groups.every(group => group.students.filter(student => student.isNewMember).length <= 1));
  assert.equal(groups.filter(group => group.students.some(student => student.isNewMember)).length, 6);
  assert.equal(harness.call('validateGeneratedGroups_', groups, students), true);
});

test('all-new population produces one-person groups without breaking the hard constraint', () => {
  const harness = createHarness();
  const students = makeStudents(['CYS', 'CYS', 'ECE', 'EEE', 'MEC'], 5);
  const groups = harness.call('buildInterdisciplinaryGroups_', students, 5, new Map(), new Set(), deterministicRandom(5));
  assert.deepEqual([...groups.map(group => group.students.length)], [1, 1, 1, 1, 1]);
  assert.ok(groups.every(group => group.students[0].isNewMember));
});

test('larger capacities with new members receive experienced mentors', () => {
  const harness = createHarness();
  const students = makeStudents(['CYS', 'ECE', 'EEE', 'MEC', 'CSE', 'CYS', 'ECE', 'EEE'], 2);
  const groups = harness.call('buildInterdisciplinaryGroups_', students, 3, new Map(), new Set(), deterministicRandom(33));
  const groupsWithNewMembers = groups.filter(group => group.students.some(student => student.isNewMember));
  assert.ok(groupsWithNewMembers.every(group => group.students.length > 1));
  assert.ok(groupsWithNewMembers.every(group => group.students.filter(student => !student.isNewMember).length >= 1));
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
  let writtenRows;
  const chain = {
    setValues(values) { calls.push('setValues'); writtenRows = values; return this; },
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
  const groups = [{ number: 1, students: makeStudents(['CYS', 'ECE'], 1) }];
  harness.call('writeShuffleSheet_', sheet, groups, '2026-08-10', new Date(), 'UTC', 2, {
    sessionTitle: 'Latest Meeting',
    attendanceDate: '2026-08-14',
    newMemberCount: 1,
    preferredGroupSize: 5,
    normalGroupCount: 1,
    groupCount: 1
  });
  assert.deepEqual(calls.slice(0, 3), ['breakApart', 'clear', 'setValues']);
  assert.ok(writtenRows.some(row => row[0] === 'Attendance Session' && row[1] === 'Latest Meeting'));
  assert.ok(writtenRows.some(row => row[0] === 'New Members' && row[1] === 1));
  assert.ok(writtenRows.some(row => row[4] === 'Member'));
  assert.ok(writtenRows.some(row => row[4] === 'New'));
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

test('partial backup creation failure leaves original feature sheets untouched', () => {
  const harness = createHarness();
  const deleted = [];
  const allSheets = [];
  const shuffle = {
    name: 'Shuffle',
    isSheetHidden: () => false,
    copyTo() {
      const backup = {
        name: 'Shuffle copy',
        setName(value) { this.name = value; return this; },
        hideSheet() { return this; }
      };
      allSheets.push(backup);
      return backup;
    }
  };
  const history = {
    name: 'Shuffle History',
    isSheetHidden: () => false,
    copyTo() { throw new Error('backup failed'); }
  };
  allSheets.push(shuffle, history);
  const spreadsheet = {
    getSheetByName(name) { return allSheets.find(sheet => sheet.name === name) || null; },
    deleteSheet(sheet) { deleted.push(sheet.name); allSheets.splice(allSheets.indexOf(sheet), 1); }
  };

  assert.throws(() => harness.call(
    'writeShuffleResultsSafely_', spreadsheet, [], [], '2026-08-10', new Date(), 'UTC', 0, {}
  ), /backup failed/);
  assert.equal(spreadsheet.getSheetByName('Shuffle'), shuffle);
  assert.equal(spreadsheet.getSheetByName('Shuffle History'), history);
  assert.equal(deleted.length, 1);
  assert.match(deleted[0], /Shuffle Backup/);
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

test('no latest session, no P students, invalid preference, and classification failure preserve output', () => {
  for (const scenario of ['no-session', 'no-present', 'invalid-preference', 'classification']) {
    let outputMutations = 0;
    const sessionRows = scenario === 'no-session'
      ? [['Session ID', 'Session Date', 'Session Title']]
      : [['Session ID', 'Session Date', 'Session Title'], ['SES-1', new Date('2026-08-14T00:00:00Z'), 'Latest']];
    const dashboardRows = [
      ['S.No', 'Name', 'Roll No', '14-08-2026'],
      [1, 'Student', 'CB.SC.U4CYS25001', scenario === 'no-present' ? 'A' : 'P']
    ];
    const spreadsheet = {
      getSheetByName(name) {
        if (name === 'Sessions') return { getDataRange: () => ({ getValues: () => sessionRows }) };
        if (name === 'Attendance Dashboard') {
          return {
            getDataRange: () => ({ getValues: () => dashboardRows }),
            getRange: () => ({ getNotes: () => [['', '', '', 'SES-1']] })
          };
        }
        if (name === 'Students') {
          return {
            getDataRange: () => {
              if (scenario === 'classification') throw new Error('classification failed');
              return { getValues: () => [
                ['Roll Number', 'Registered At'],
                ['CB.SC.U4CYS25001', new Date('2026-08-01T00:00:00Z')]
              ] };
            }
          };
        }
        return null;
      },
      insertSheet() { outputMutations += 1; },
      deleteSheet() { outputMutations += 1; },
      toast() { outputMutations += 1; }
    };
    const alerts = [];
    const ui = {
      Button: { OK: 'OK' },
      ButtonSet: { OK_CANCEL: 'OK_CANCEL' },
      prompt: () => ({
        getSelectedButton: () => 'OK',
        getResponseText: () => scenario === 'invalid-preference' ? '0' : '1'
      }),
      alert: message => alerts.push(message)
    };
    const harness = createHarness({
      spreadsheet,
      SpreadsheetApp: { getUi: () => ui }
    });
    harness.call('shuffleStudentsIntoGroups');
    assert.equal(outputMutations, 0, scenario);
  }
});

test('candidate generation failure preserves Shuffle History', () => {
  let outputMutations = 0;
  const spreadsheet = {
    getSheetByName(name) {
      if (name === 'Sessions') return { getDataRange: () => ({ getValues: () => [
        ['Session ID', 'Session Date', 'Session Title'],
        ['SES-1', new Date('2026-08-14T00:00:00Z'), 'Latest']
      ] }) };
      if (name === 'Attendance Dashboard') return {
        getDataRange: () => ({ getValues: () => [
          ['S.No', 'Name', 'Roll No', '14-08-2026'],
          [1, 'Student', 'CB.SC.U4CYS25001', 'P']
        ] }),
        getRange: () => ({ getNotes: () => [['', '', '', 'SES-1']] })
      };
      if (name === 'Students') return { getDataRange: () => ({ getValues: () => [
        ['Roll Number', 'Registered At'], ['CB.SC.U4CYS25001', new Date('2026-08-01T00:00:00Z')]
      ] }) };
      if (name === 'Shuffle History') return null;
      return null;
    },
    insertSheet() { outputMutations += 1; },
    deleteSheet() { outputMutations += 1; },
    toast() { outputMutations += 1; }
  };
  const ui = {
    Button: { OK: 'OK' },
    ButtonSet: { OK_CANCEL: 'OK_CANCEL' },
    prompt: () => ({ getSelectedButton: () => 'OK', getResponseText: () => '1' }),
    alert() {}
  };
  const harness = createHarness({ spreadsheet, SpreadsheetApp: { getUi: () => ui } });
  harness.context.buildInterdisciplinaryGroups_ = () => { throw new Error('candidate failed'); };
  harness.call('shuffleStudentsIntoGroups');
  assert.equal(outputMutations, 0);
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
