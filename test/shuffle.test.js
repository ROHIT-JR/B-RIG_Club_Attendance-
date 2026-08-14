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
      MARKERS: { PRESENT: 'P', ABSENT: 'A' },
      STATUS: { STUDENT: { ACTIVE: 'Active' } },
      GENDER: { HEADER: 'Gender' }
    },
    SpreadsheetApp: overrides.SpreadsheetApp || {},
    HtmlService: overrides.HtmlService || {},
    LockService: overrides.LockService || {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
      getDocumentLock: () => ({ waitLock() {}, releaseLock() {} })
    },
    Utilities: overrides.Utilities || {
      formatDate(date, timeZone, format) {
        if (format === 'yyyy-MM-dd') return date.toISOString().slice(0, 10);
        return date.toISOString();
      }
    },
    getAttendanceSpreadsheet: overrides.getAttendanceSpreadsheet || (() => overrides.spreadsheet),
    getSetting: overrides.getSetting || (() => 'UTC'),
    normalizeRollNo: value => String(value || '').trim().toUpperCase(),
    normalizeGender: value => {
      const normalized = String(value || '').trim().toLowerCase();
      return normalized === 'male' ? 'Male' : normalized === 'female' ? 'Female' : '';
    },
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
    isNewMember: index < newMemberCount,
    gender: index % 2 === 0 ? 'Female' : 'Male'
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
  const dashboard = {
    getDataRange: () => ({ getValues: () => dashboardRows }),
    getRange: () => ({ getNotes: () => [['', '', '', 'SES-OLD', 'SES-LATEST']] })
  };
  const spreadsheet = {
    getSheetByName(name) {
      if (name === 'Attendance Dashboard') return dashboard;
      return null;
    }
  };
  const harness = createHarness({ spreadsheet });
  const session = { sessionId: 'SES-LATEST', date: new Date('2026-08-14T00:00:00Z') };
  const metadata = new Map([
    ['CB.SC.U4CYS25001', { gender: 'Male' }],
    ['CB.SC.U4EEE25003', { gender: 'Female' }],
    ['CB.SC.U4MEC25004', { gender: 'Male' }]
  ]);
  const context = {
    dashboardData: dashboardRows,
    dashboardHeaders: dashboardRows[0],
    attendanceColumn: 4,
    priorPresentRolls: new Set(['CB.SC.U4CYS25001', 'CB.SC.U4MEC25004']),
    studentMetadata: metadata
  };
  const students = plain(harness.call('getEligibleShuffleStudents_', spreadsheet, session, 'UTC', context));
  assert.deepEqual(students.map(student => [student.fullName, student.isNewMember]), [
    ['Arun', false],
    ['Chris', true],
    ['Diya', false]
  ]);
});

test('absent selector offers only unique Active students who are not present', () => {
  const studentRows = [
    ['Roll Number', 'Full Name', 'Status', 'Registered At', 'Gender'],
    ['CB.SC.U4CYS25001', 'Present Student', 'Active', new Date('2026-08-01T00:00:00Z'), 'Male'],
    ['CB.EN.U4EEE25002', 'Selected Absent', 'active', new Date('2026-08-14T09:00:00Z'), 'Female'],
    ['CB.SC.U4ECE25003', 'Pending Student', 'Pending', new Date('2026-08-14T09:00:00Z'), 'Male'],
    ['CB.SC.U4MEC25004', 'Inactive Student', 'Inactive', new Date('2026-08-01T00:00:00Z'), 'Male'],
    ['CB.SC.U4CSE25005', '', 'Active', new Date('2026-08-01T00:00:00Z'), 'Female'],
    ['CB.SC.U4CSE25006', 'Pre-registration Student', 'Active', new Date('2026-08-15T00:00:00Z'), 'Female']
  ];
  const dashboardRows = [
    ['S.No', 'Name', 'Roll No', '14-08-2026'],
    [1, 'Present Student', 'CB.SC.U4CYS25001', 'P'],
    [2, 'Selected Absent', 'CB.EN.U4EEE25002', 'A'],
    [3, 'Pending Student', 'CB.SC.U4ECE25003', 'A'],
    [4, 'Inactive Student', 'CB.SC.U4MEC25004', 'A'],
    [5, '', 'CB.SC.U4CSE25005', 'A'],
    [6, 'Pre-registration Student', 'CB.SC.U4CSE25006', '—']
  ];
  const dashboard = {
    getDataRange: () => ({ getValues: () => dashboardRows }),
    getRange: () => ({ getNotes: () => [['', '', '', 'SES-1']] })
  };
  const spreadsheet = {
    getSheetByName(name) {
      if (name === 'Students') return { getDataRange: () => ({ getValues: () => studentRows }) };
      if (name === 'Attendance Dashboard') return dashboard;
      return null;
    }
  };
  const harness = createHarness({ spreadsheet });
  const present = [{ rollNumber: 'CB.SC.U4CYS25001' }];
  const session = { sessionId: 'SES-1', date: new Date('2026-08-14T00:00:00Z') };
  const context = {
    dashboardData: dashboardRows,
    dashboardHeaders: dashboardRows[0],
    attendanceColumn: 3,
    priorPresentRolls: new Set(),
    studentMetadata: harness.call('getShuffleStudentMetadata_', spreadsheet)
  };
  const absent = plain(harness.call(
    'getEligibleAbsentShuffleStudents_', spreadsheet, present, session, 'UTC', context
  ));
  assert.deepEqual(absent, [{
    rollNumber: 'CB.EN.U4EEE25002',
    fullName: 'Selected Absent',
    department: 'EEE',
    gender: 'Female',
    isNewMember: true,
    participationSource: 'Admin Added (Absent)'
  }]);
});

test('server selection includes only explicitly selected eligible absent rolls', () => {
  const harness = createHarness();
  const present = [{
    rollNumber: 'CB.SC.U4CYS25001', fullName: 'Present', department: 'CYS',
    isNewMember: false, participationSource: 'Present'
  }];
  const absent = [
    { rollNumber: 'CB.EN.U4EEE25002', fullName: 'Chosen', department: 'EEE', isNewMember: true, participationSource: 'Admin Added (Absent)' },
    { rollNumber: 'CB.SC.U4ECE25003', fullName: 'Not Chosen', department: 'ECE', isNewMember: false, participationSource: 'Admin Added (Absent)' }
  ];
  const participants = plain(harness.call(
    'buildFinalShuffleParticipants_', present, absent,
    ['cb.en.u4eee25002', 'CB.EN.U4EEE25002', 'CB.UNKNOWN25004']
  ));
  assert.deepEqual(participants.map(student => student.rollNumber), [
    'CB.SC.U4CYS25001', 'CB.EN.U4EEE25002'
  ]);
  assert.equal(participants[1].isNewMember, true);
  assert.equal(participants[1].participationSource, 'Admin Added (Absent)');
});

test('student who becomes present before modal submission appears only once', () => {
  const harness = createHarness();
  const nowPresent = {
    rollNumber: 'CB.EN.U4EEE25002', fullName: 'Now Present', department: 'EEE',
    isNewMember: true, participationSource: 'Present'
  };
  const staleAbsentChoice = {
    ...nowPresent,
    participationSource: 'Admin Added (Absent)'
  };
  const participants = harness.call(
    'buildFinalShuffleParticipants_', [nowPresent], [staleAbsentChoice], ['CB.EN.U4EEE25002']
  );
  assert.equal(participants.length, 1);
  assert.equal(participants[0].participationSource, 'Present');
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

test('prior session IDs stop strictly before the latest session', () => {
  const rows = [
    ['Session ID', 'Session Date'],
    ['SES-OLD', new Date('2026-08-07T00:00:00Z')],
    ['SES-SAME-DAY', new Date('2026-08-14T00:00:00Z')],
    ['SES-LATEST', new Date('2026-08-14T00:00:00Z')]
  ];
  const spreadsheet = { getSheetByName: () => ({ getDataRange: () => ({ getValues: () => rows }) }) };
  const harness = createHarness({ spreadsheet });
  assert.deepEqual(
    [...harness.call('getPriorShuffleSessionIds_', spreadsheet, 'SES-LATEST')],
    ['SES-OLD', 'SES-SAME-DAY']
  );
});

test('duplicate session IDs are rejected before prior-attendance classification', () => {
  const rows = [
    ['Session ID', 'Session Date'],
    ['SES-LATEST', new Date('2026-08-07T00:00:00Z')],
    ['SES-OTHER', new Date('2026-08-10T00:00:00Z')],
    ['SES-LATEST', new Date('2026-08-14T00:00:00Z')]
  ];
  const spreadsheet = { getSheetByName: () => ({ getDataRange: () => ({ getValues: () => rows }) }) };
  const harness = createHarness({ spreadsheet });
  assert.throws(
    () => harness.call('getPriorShuffleSessionIds_', spreadsheet, 'SES-LATEST'),
    /duplicate session IDs/i
  );
});

test('invalid nonblank Gender data blocks Shuffle metadata loading', () => {
  for (const gender of ['Other', 'male', ' Male ']) {
    const rows = [
      ['Roll Number', 'Full Name', 'Status', 'Gender'],
      ['CB.SC.U4CYS25001', 'Student', 'Active', gender]
    ];
    const spreadsheet = {
      getSheetByName: name => name === 'Students'
        ? { getDataRange: () => ({ getValues: () => rows }) }
        : null
    };
    const harness = createHarness({ spreadsheet });
    assert.throws(() => harness.call('getShuffleStudentMetadata_', spreadsheet), /invalid Gender/i);
  }
});

test('duplicate normalized student rolls block Shuffle metadata loading', () => {
  const rows = [
    ['Roll Number', 'Full Name', 'Status', 'Gender'],
    ['CB.SC.U4CYS25001', 'First', 'Active', 'Male'],
    [' cb.sc.u4cys25001 ', 'Second', 'Active', 'Female']
  ];
  const spreadsheet = {
    getSheetByName: name => name === 'Students'
      ? { getDataRange: () => ({ getValues: () => rows }) }
      : null
  };
  const harness = createHarness({ spreadsheet });
  assert.throws(() => harness.call('getShuffleStudentMetadata_', spreadsheet), /duplicate normalized roll/i);
});

test('genuine new classification counts only prior P markers from validated session columns', () => {
  const sessionRows = [
    ['Session ID', 'Session Date', 'Session Title'],
    ['SES-OLD', new Date('2026-08-07T00:00:00Z'), 'Old'],
    ['SES-LATEST', new Date('2026-08-14T00:00:00Z'), 'Latest']
  ];
  const dashboardRows = [
    ['S.No', 'Name', 'Roll No', 'Old', 'Unrelated', 'Latest'],
    [1, 'Prior Present', 'CB.SC.U4CYS25001', 'P', 'P', 'P'],
    [2, 'Prior Absent', 'CB.SC.U4EEE25002', 'A', 'P', 'P'],
    [3, 'Prior Blank', 'CB.SC.U4ECE25003', '', 'P', 'P']
  ];
  const studentRows = [
    ['Roll Number', 'Full Name', 'Status', 'Gender'],
    ['CB.SC.U4CYS25001', 'Prior Present', 'Active', 'Male'],
    ['CB.SC.U4EEE25002', 'Prior Absent', 'Active', 'Female'],
    ['CB.SC.U4ECE25003', 'Prior Blank', 'Active', 'Female']
  ];
  const dashboard = {
    getDataRange: () => ({ getValues: () => dashboardRows }),
    getRange: () => ({ getNotes: () => [['', '', '', 'SES-OLD', '', 'SES-LATEST']] })
  };
  const spreadsheet = {
    getSheetByName(name) {
      if (name === 'Sessions') return { getDataRange: () => ({ getValues: () => sessionRows }) };
      if (name === 'Attendance Dashboard') return dashboard;
      if (name === 'Students') return { getDataRange: () => ({ getValues: () => studentRows }) };
      return null;
    }
  };
  const harness = createHarness({ spreadsheet });
  const session = { sessionId: 'SES-LATEST', date: new Date('2026-08-14T00:00:00Z') };
  const students = harness.call('getEligibleShuffleStudents_', spreadsheet, session, 'UTC');
  assert.deepEqual(plain(students.map(student => [student.rollNumber, student.isNewMember])), [
    ['CB.SC.U4CYS25001', false],
    ['CB.SC.U4EEE25002', true],
    ['CB.SC.U4ECE25003', true]
  ]);
});

test('department extraction uses the final three programme letters and falls back to UNK', () => {
  const harness = createHarness();
  assert.equal(harness.call('extractDepartmentFromRoll_', 'CB.SC.U4CYS25048'), 'CYS');
  assert.equal(harness.call('extractDepartmentFromRoll_', 'CB.EN.CAMPUS.U4EEE25001'), 'EEE');
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
      assert.equal(message, 'Enter the preferred number of members per group:');
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

test('absent selector modal receives safe display data and preferred size', () => {
  let templateName = '';
  let shownTitle = '';
  let evaluated = false;
  const output = {
    setWidth() { return this; },
    setHeight() { return this; }
  };
  const template = {
    selectorDataJson: '',
    evaluate() { evaluated = true; return output; }
  };
  const harness = createHarness({
    HtmlService: {
      createTemplateFromFile(name) { templateName = name; return template; }
    },
    SpreadsheetApp: {
      getUi: () => ({ showModalDialog(html, title) { assert.equal(html, output); shownTitle = title; } })
    }
  });
  harness.call(
    'showShuffleAbsentSelector_',
    [{ rollNumber: 'CB.SC.U4CYS25001' }],
    [{ rollNumber: 'CB.EN.U4EEE25002', fullName: '<Student>', department: 'EEE', isNewMember: true }],
    { sessionId: 'SES-1', title: 'Latest', date: new Date('2026-08-14T00:00:00Z') },
    5,
    'UTC'
  );
  assert.equal(templateName, 'ShuffleAbsentSelector');
  assert.equal(shownTitle, 'Add absent students (optional)');
  assert.equal(evaluated, true);
  assert.match(template.selectorDataJson, /\\u003cStudent>/);
  assert.match(template.selectorDataJson, /"sessionId":"SES-1"/);
  assert.match(template.selectorDataJson, /"preferredGroupSize":5/);
});

test('zero present students can continue to the selector when an Active absent student exists', () => {
  let modalShown = false;
  let toastMessage = '';
  const spreadsheet = {
    getSheetByName(name) {
      if (name === 'Sessions') return { getDataRange: () => ({ getValues: () => [
        ['Session ID', 'Session Date', 'Session Title'],
        ['SES-1', new Date('2026-08-14T00:00:00Z'), 'Latest']
      ] }) };
      if (name === 'Attendance Dashboard') return {
        getDataRange: () => ({ getValues: () => [
          ['S.No', 'Name', 'Roll No', '14-08-2026'],
          [1, 'Absent Student', 'CB.EN.U4EEE25001', 'A']
        ] }),
        getRange: () => ({ getNotes: () => [['', '', '', 'SES-1']] })
      };
      if (name === 'Students') return { getDataRange: () => ({ getValues: () => [
        ['Roll Number', 'Full Name', 'Status', 'Registered At', 'Gender'],
        ['CB.EN.U4EEE25001', 'Absent Student', 'Active', new Date('2026-08-01T00:00:00Z'), 'Female']
      ] }) };
      return null;
    },
    toast(message) { toastMessage = message; }
  };
  const output = { setWidth() { return this; }, setHeight() { return this; } };
  const ui = {
    Button: { OK: 'OK' },
    ButtonSet: { OK_CANCEL: 'OK_CANCEL' },
    prompt: () => ({ getSelectedButton: () => 'OK', getResponseText: () => '1' }),
    showModalDialog() { modalShown = true; },
    alert() {}
  };
  const harness = createHarness({
    spreadsheet,
    SpreadsheetApp: { getUi: () => ui },
    HtmlService: { createTemplateFromFile: () => ({ evaluate: () => output }) }
  });
  harness.call('shuffleStudentsIntoGroups');
  assert.equal(modalShown, true);
  const empty = harness.call('finalizeShuffleWithAbsent', 1, [], 'SES-1');
  assert.equal(empty.empty, true);
  assert.equal(empty.groupCount, 0);
  assert.match(toastMessage, /existing Shuffle output was not changed/i);
});

test('admin selector is Sheets-only, defaults to no selection, and calls server revalidation', () => {
  const html = fs.readFileSync('ShuffleAbsentSelector.html', 'utf8');
  assert.match(html, /Add absent students \(optional\)/);
  assert.match(html, /type="search"/);
  assert.match(html, /const selected = new Set\(\)/);
  assert.match(html, /Generate Teams/);
  assert.match(html, /google\.script\.run/);
  assert.match(html, /finalizeShuffleWithAbsent\(data\.preferredGroupSize, \[\.\.\.selected\], data\.sessionId\)/);
  assert.match(html, /google\.script\.host\.close\(\)/);
  assert.doesNotMatch(html, /<input[^>]+\schecked(?:=|\s|>)/i);
});

test('every student is assigned exactly once with balanced group sizes', () => {
  const harness = createHarness();
  const students = makeStudents(['CYS', 'ECE', 'EEE', 'MEC', 'CYS', 'ECE', 'EEE', 'MEC', 'CYS', 'ECE', 'EEE']);
  const groups = harness.call('buildInterdisciplinaryGroups_', students, 3, new Map(), new Set(), deterministicRandom());
  assert.equal(harness.call('validateGeneratedGroups_', groups, students), true);
  const sizes = groups.map(group => group.students.length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
});

test('seeded grouping is reproducible and maximizes feasible Female coverage', () => {
  const harness = createHarness();
  const students = makeStudents(['CYS', 'ECE', 'EEE', 'MEC', 'CYS', 'ECE', 'EEE', 'MEC', 'CYS', 'ECE', 'EEE', 'MEC']);
  students.forEach((student, index) => { student.gender = index < 3 ? 'Female' : 'Male'; });
  const build = (input = students) => harness.call(
    'buildInterdisciplinaryGroups_', input, 3, new Map(), new Set(),
    harness.call('createSeededRandom_', '1234abcd')
  );
  const first = build();
  const second = build();
  const reordered = build(students.slice().reverse());
  assert.deepEqual(plain(
    first.map(group => group.students.map(student => student.rollNumber)),
  ), plain(second.map(group => group.students.map(student => student.rollNumber)))
  );
  assert.deepEqual(
    plain(first.map(group => group.students.map(student => student.rollNumber))),
    plain(reordered.map(group => group.students.map(student => student.rollNumber)))
  );
  const metrics = harness.call('calculateShuffleMetrics_', first, students);
  assert.equal(metrics.femaleCoverageTarget, 3);
  assert.equal(metrics.femaleCoveredTeams, 3);
  assert.equal(metrics.multidisciplinaryTeams, metrics.multidisciplinaryTarget);
});

test('insufficient Female and experienced populations report truthful coverage', () => {
  const harness = createHarness();
  const students = makeStudents(['CYS', 'ECE', 'EEE', 'MEC', 'CYS', 'ECE'], 4);
  students.forEach((student, index) => { student.gender = index === 0 ? 'Female' : 'Male'; });
  const groups = harness.call(
    'buildInterdisciplinaryGroups_', students, 4, new Map(), new Set(), deterministicRandom(42)
  );
  const metrics = harness.call('calculateShuffleMetrics_', groups, students);
  assert.equal(metrics.femaleCoverageTarget, 1);
  assert.equal(metrics.femaleCoveredTeams, 1);
  assert.equal(metrics.newMemberTeams, 4);
  assert.equal(metrics.supportedNewTeams, 2);
  assert.equal(metrics.unsupportedNewTeams, 2);
});

test('seeded population sweep preserves membership, balance, newcomer limits, and metric counts', () => {
  const harness = createHarness();
  const departments = ['CYS', 'ECE', 'EEE', 'MEC'];
  for (let participantCount = 1; participantCount <= 40; participantCount++) {
    const newCount = participantCount % Math.min(7, participantCount + 1);
    const preferredSize = 1 + (participantCount % 6);
    const students = makeStudents(
      Array.from({ length: participantCount }, (_, index) => departments[(index * 3 + participantCount) % departments.length]),
      newCount
    );
    students.forEach((student, index) => { student.gender = index % 3 === 0 ? 'Female' : 'Male'; });
    const groupCount = harness.call('calculateShuffleGroupCount_', participantCount, preferredSize, newCount);
    const groups = harness.call(
      'buildInterdisciplinaryGroups_', students, groupCount, new Map(), new Set(),
      harness.call('createSeededRandom_', (participantCount * 7919).toString(16))
    );
    assert.equal(harness.call('validateGeneratedGroups_', groups, students), true);
    const metrics = harness.call('calculateShuffleMetrics_', groups, students);
    assert.equal(metrics.genuineNewCount, newCount);
    assert.equal(metrics.teamsWithMultipleNew, 0);
    assert.ok(metrics.femaleCoveredTeams <= metrics.femaleCoverageTarget);
    assert.equal(metrics.supportedNewTeams + metrics.unsupportedNewTeams, metrics.newMemberTeams);
  }
});

test('empty participant metrics produce a clear zero-group result', () => {
  const harness = createHarness();
  const metrics = harness.call('calculateShuffleMetrics_', [], []);
  assert.equal(metrics.genuineNewCount, 0);
  assert.equal(metrics.femaleCoverageTarget, 0);
  assert.equal(metrics.multidisciplinaryTarget, 0);
  assert.equal(metrics.minSize, 0);
  assert.equal(metrics.maxSize, 0);
});

test('production seed covers public assignment inputs without encoding Gender', () => {
  const harness = createHarness();
  const students = makeStudents(['CYS', 'ECE']);
  const history = { pairCounts: new Map(), recentPairs: new Set() };
  const first = harness.call('createShuffleSeed_', 'SES-1', '2026-08-10', students, 2, 1, history);
  const sizeChanged = harness.call('createShuffleSeed_', 'SES-1', '2026-08-10', students, 1, 2, history);
  students[0].gender = 'Male';
  const genderChanged = harness.call('createShuffleSeed_', 'SES-1', '2026-08-10', students, 2, 1, history);
  assert.notEqual(first, sizeChanged);
  assert.equal(first, genderChanged);
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
  assert.ok(writtenRows.some(row => row[0] === 'Genuine New Members' && row[1] === 1));
  assert.ok(writtenRows.some(row => row[4] === 'Member'));
  assert.ok(writtenRows.some(row => row[4] === 'New'));
  assert.ok(writtenRows.some(row => row[5] === 'Participation Source'));
  assert.ok(writtenRows.some(row => row[5] === 'Present'));
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

test('backup naming failure removes the copied sheet', () => {
  const harness = createHarness();
  const deleted = [];
  const copy = {
    setName() { throw new Error('naming failed'); }
  };
  const shuffle = {
    isSheetHidden: () => false,
    copyTo: () => copy
  };
  const spreadsheet = {
    getSheetByName: name => name === 'Shuffle' ? shuffle : null,
    deleteSheet(sheet) { deleted.push(sheet); }
  };

  assert.throws(() => harness.call(
    'writeShuffleResultsSafely_', spreadsheet, [], [], '2026-08-10', new Date(), 'UTC', 0, {}
  ), /naming failed/);
  assert.deepEqual(deleted, [copy]);
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
                ['Roll Number', 'Full Name', 'Status', 'Registered At', 'Gender'],
                ['CB.SC.U4CYS25001', 'Student', scenario === 'no-present' ? 'Inactive' : 'Active', new Date('2026-08-01T00:00:00Z'), 'Male']
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

test('stale modal session is rejected under the shared script lock without output mutation', () => {
  const events = [];
  let outputMutations = 0;
  const spreadsheet = {
    getSheetByName(name) {
      events.push(`read:${name}`);
      if (name === 'Sessions') return { getDataRange: () => ({ getValues: () => [
        ['Session ID', 'Session Date', 'Session Title'],
        ['SES-NEW', new Date('2026-08-14T00:00:00Z'), 'New session']
      ] }) };
      return null;
    },
    insertSheet() { outputMutations += 1; },
    deleteSheet() { outputMutations += 1; },
    toast() { outputMutations += 1; }
  };
  const harness = createHarness({
    spreadsheet,
    LockService: {
      getScriptLock: () => ({
        waitLock() { events.push('lock'); },
        releaseLock() { events.push('unlock'); }
      })
    }
  });
  assert.throws(
    () => harness.call('finalizeShuffleWithAbsent', 5, [], 'SES-OLD'),
    /newer attendance session/i
  );
  assert.deepEqual(events, ['lock', 'read:Sessions', 'unlock']);
  assert.equal(outputMutations, 0);
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
        ['Roll Number', 'Full Name', 'Status', 'Registered At', 'Gender'],
        ['CB.SC.U4CYS25001', 'Student', 'Active', new Date('2026-08-01T00:00:00Z'), 'Male']
      ] }) };
      if (name === 'Shuffle History') return null;
      return null;
    },
    insertSheet() { outputMutations += 1; },
    deleteSheet() { outputMutations += 1; },
    toast() { outputMutations += 1; }
  };
  const harness = createHarness({ spreadsheet });
  harness.context.buildInterdisciplinaryGroups_ = () => { throw new Error('candidate failed'); };
  assert.throws(() => harness.call('finalizeShuffleWithAbsent', 1, [], 'SES-1'), /candidate failed/);
  assert.equal(outputMutations, 0);
});

test('manual absent selection has no attendance mutation path', () => {
  assert.doesNotMatch(shuffleSource, /CONFIG\.SHEETS\.CHECKINS|appendRow\(|\.setValue\(/);
  assert.doesNotMatch(shuffleSource, /submitAttendance|validateRollNo|DB\.withLock/);
});

test('protected QR and deployment files remain byte-identical', () => {
  const expectedHashes = {
    'AdminSidebar.html': '601d56dc2985cefd173545ca047f6526d53fd15e54a6efcbab03c626ea21788e',
    'appsscript.json': '7ac9773a041fa8c532a9102a881594471de56af49720e3cbfb619a7272dbc793',
    'vercel/vercel.json': 'f036dcc45aacfa11311008f5c3c36e51b2b2928f680d69602e2b8dff5b930b82',
    'vercel/package.json': '67823a4444364bbec1e7bbba1aa14aeaf756250c5d42bc73419510c16e2a66be',
    'vercel/package-lock.json': '9698f1b8376b0ad130fd08f75dc0feb79393de2f64be78fa4bc87e5cfcf0f12a',
    'vercel/.env.example': '311ec6d2ee8a45bf056ca0cda447b9884115a32a2d7b9ea5ec8bf85ef7fa233a',
  };
  for (const [path, expectedHash] of Object.entries(expectedHashes)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
    assert.equal(actual, expectedHash, `${path} changed outside the allowed boundary`);
  }
});
