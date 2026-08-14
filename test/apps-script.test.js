'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const CONFIG_SOURCE = fs.readFileSync('Config.js', 'utf8');
const CODE_SOURCE = fs.readFileSync('Code.js', 'utf8');
const DATABASE_SOURCE = fs.readFileSync('Database.js', 'utf8');
const API_SECRET = 'test-vercel-api-secret-at-least-32-characters';
const DEVICE_ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_DEVICE_ID = '123e4567-e89b-42d3-b456-426614174001';
const ROLL_NUMBER = 'CB.SC.U4CYS25048';
const OFFICIAL_EMAIL = 'cb.sc.u4cys25048@cb.students.amrita.edu';
const STUDENT_HEADERS = [
  'Student ID', 'Roll Number', 'Full Name', 'Status', 'Registered At',
  'Created By', 'Notes', 'Official Email', 'Gender'
];

function createOutput(content) {
  return {
    content,
    mimeType: '',
    setMimeType(mimeType) {
      this.mimeType = mimeType;
      return this;
    }
  };
}

function createHarness(options = {}) {
  const properties = new Map([['VERCEL_API_SECRET', API_SECRET]]);
  const cache = new Map();
  const settings = {
    'Student Web App URL': 'https://b-rig-attendance.vercel.app',
    'Public Web App URL': '',
    'Club Name': 'B-RIG',
    'Time zone': 'Asia/Kolkata',
    ...(options.settings || {})
  };
  const session = options.session || {
    sessionId: 'SES-1',
    token: 'session-token',
    title: 'Weekly Meeting',
    date: new Date('2026-08-07T00:00:00Z'),
    opensAt: new Date(Date.now() - 60_000),
    closesAt: new Date(Date.now() + 60_000),
    status: 'Open'
  };
  const db = options.db || {
    getSessionByToken: token => token === session.token ? session : null,
    getStudentByRollNo: () => null
  };

  const context = vm.createContext({
    console: options.console || console,
    DB: db,
    SpreadsheetApp: options.SpreadsheetApp || {
      getActiveSpreadsheet() {
        throw new Error('Unexpected spreadsheet access in test.');
      }
    },
    HtmlService: {},
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: createOutput
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => properties.get(key) || null,
        setProperty: (key, value) => properties.set(key, value)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: key => cache.get(key) || null,
        put: (key, value) => cache.set(key, value),
        remove: key => cache.delete(key)
      })
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() {},
        releaseLock() {}
      })
    },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      DigestAlgorithm: { SHA_256: 'SHA-256' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (algorithm, value) => [...crypto.createHash('sha256').update(value).digest()],
      computeHmacSha256Signature: (value, key) => [...crypto.createHmac('sha256', key).update(value).digest()],
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      formatDate: () => '07-08-2026'
    },
    encodeURIComponent
  });

  context.__settings = settings;
  vm.runInContext(
    CONFIG_SOURCE + '\n' + CODE_SOURCE + '\n' +
      "getSetting = key => Object.prototype.hasOwnProperty.call(__settings, key) ? __settings[key] : '';",
    context
  );

  return {
    cache,
    context,
    db,
    properties,
    session,
    call(functionName, ...args) {
      context.__args = args;
      return vm.runInContext(`${functionName}(...__args)`, context);
    },
    evaluate(source) {
      return vm.runInContext(source, context);
    },
    post(body, type = 'application/json') {
      const output = this.call('doPost', {
        postData: { type, contents: typeof body === 'string' ? body : JSON.stringify(body) }
      });
      return JSON.parse(output.content);
    },
    issueQr() {
      cache.set('admin-qr:test-admin-grant', session.token);
      return this.call('getRotatingQrData', session.token, 'test-admin-grant');
    }
  };
}

function grantFromQr(harness, deviceId = DEVICE_ID) {
  const qr = harness.issueQr();
  const url = new URL(qr.url);
  const details = harness.call(
    'getClientSessionDetails',
    url.searchParams.get('session'),
    url.searchParams.get('access'),
    url.searchParams.get('expires'),
    deviceId
  );
  return { details, qr, url };
}

test('generates a direct signed Vercel QR with no Google routing workaround', () => {
  const harness = createHarness();
  const qr = harness.issueQr();
  const url = new URL(qr.url);

  assert.equal(qr.valid, true);
  assert.equal(url.origin, 'https://b-rig-attendance.vercel.app');
  assert.equal(url.searchParams.get('session'), harness.session.token);
  assert.ok(url.searchParams.get('access'));
  assert.ok(url.searchParams.get('expires'));
  assert.doesNotMatch(qr.url, /script\.google\.com|authuser|github\.io|qr\.html/);
  assert.equal(qr.refreshAfterSeconds, 10);
  assert.ok(qr.expiresAt > Date.now());
});

test('accepts root HTTPS student domains and rejects ambiguous or unsafe URLs', () => {
  const harness = createHarness();
  const results = harness.evaluate(`[
    isValidStudentAppUrl('https://attendance.example.edu/'),
    isValidStudentAppUrl('https://club.vercel.app'),
    isValidStudentAppUrl('https://attendance.example.edu/path'),
    isValidStudentAppUrl('https://attendance.example.edu/?source=qr'),
    isValidStudentAppUrl('http://club.vercel.app'),
    isValidStudentAppUrl('javascript:alert(1)'),
    isValidStudentAppUrl('https://invalid..example'),
    isValidStudentAppUrl('https://user.github.io'),
    isValidStudentAppUrl('https://example.edu:65536'),
    isValidStudentAppUrl('https://127.1'),
    isValidStudentAppUrl('https://0x7f.1'),
    isValidStudentAppUrl('https://accounts.google.com'),
    isValidStudentAppUrl('https://sites.google.com'),
    isValidStudentAppUrl('https://script.google.com/macros/s/ABC/exec'),
    isAppsScriptWebAppUrl('https://script.google.com/macros/s/ABC/exec')
  ]`);

  assert.deepEqual(
    [...results],
    [true, true, false, false, false, false, false, false, false, false, false, false, false, false, true]
  );
});

test('database rejects malformed or reversed session date ranges', () => {
  const headers = [
    'Session ID', 'Session Date', 'Session Title', 'Opens At', 'Closes At',
    'Status', 'Token', 'Created At', 'Created By'
  ];
  const rows = [
    headers,
    ['SES-BAD', new Date(), 'Bad', '', new Date(Date.now() + 60_000), 'Open', 'bad-token'],
    ['SES-REVERSED', new Date(), 'Reversed', new Date(Date.now() + 60_000), new Date(), 'Open', 'reversed-token'],
    ['SES-GOOD', new Date(), 'Good', new Date(Date.now() - 60_000), new Date(Date.now() + 60_000), 'Open', 'good-token']
  ];
  const context = vm.createContext({
    console,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => null,
        setProperty() {}
      })
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: () => ({
          getDataRange: () => ({ getValues: () => rows })
        })
      })
    }
  });
  vm.runInContext(CONFIG_SOURCE + '\n' + DATABASE_SOURCE, context);

  assert.equal(vm.runInContext("DB.getSessionByToken('bad-token')", context), null);
  assert.equal(vm.runInContext("DB.getSessionByToken('reversed-token')", context), null);
  assert.equal(vm.runInContext("DB.getSessionByToken('good-token').sessionId", context), 'SES-GOOD');
});

test('records the bound Sheet ID and reopens it during web-app execution', () => {
  const boundSheet = { getId: () => 'sheet-123' };
  const boundHarness = createHarness({
    SpreadsheetApp: { getActiveSpreadsheet: () => boundSheet }
  });

  assert.equal(boundHarness.call('getAttendanceSpreadsheet'), boundSheet);
  assert.equal(boundHarness.properties.get('SPREADSHEET_ID'), 'sheet-123');

  let openedId = '';
  let openCount = 0;
  const webSheet = { name: 'web-app-sheet' };
  const webHarness = createHarness({
    SpreadsheetApp: {
      getActiveSpreadsheet: () => null,
      openById: spreadsheetId => {
        openCount += 1;
        openedId = spreadsheetId;
        return webSheet;
      }
    }
  });
  webHarness.properties.set('SPREADSHEET_ID', 'sheet-123');

  assert.equal(webHarness.call('getAttendanceSpreadsheet'), webSheet);
  assert.equal(webHarness.call('getAttendanceSpreadsheet'), webSheet);
  assert.equal(openedId, 'sheet-123');
  assert.equal(openCount, 1);
});

test('classifies missing or inaccessible workbook configuration', () => {
  const missingHarness = createHarness({
    SpreadsheetApp: { getActiveSpreadsheet: () => null }
  });
  assert.throws(
    () => missingHarness.call('getAttendanceSpreadsheet'),
    error => error.name === 'AttendanceConfigurationError'
  );

  const inaccessibleHarness = createHarness({
    console: { error() {}, log() {} },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => null,
      openById: () => { throw new Error('Permission denied'); }
    }
  });
  inaccessibleHarness.properties.set('SPREADSHEET_ID', 'inaccessible-sheet');
  assert.throws(
    () => inaccessibleHarness.call('getAttendanceSpreadsheet'),
    error => error.name === 'AttendanceConfigurationError'
  );
});

test('issues a device-bound grant only for a valid live QR and open session', () => {
  const harness = createHarness();
  const { details, url } = grantFromQr(harness);

  assert.equal(details.valid, true);
  assert.equal(details.title, 'Weekly Meeting');
  assert.equal(details.clubName, 'B-RIG');
  assert.ok(details.accessGrant);
  assert.equal(
    harness.call('isValidAccessGrant_', details.accessGrant, harness.session.token, DEVICE_ID),
    true
  );
  assert.equal(
    harness.call('isValidAccessGrant_', details.accessGrant, harness.session.token, OTHER_DEVICE_ID),
    false
  );

  assert.equal(
    harness.call('getClientSessionDetails', harness.session.token, 'tampered', url.searchParams.get('expires'), DEVICE_ID).valid,
    false
  );
  assert.equal(
    harness.call('getClientSessionDetails', harness.session.token, url.searchParams.get('access'), '1', DEVICE_ID).valid,
    false
  );
  assert.equal(
    harness.call('getClientSessionDetails', harness.session.token, url.searchParams.get('access'), url.searchParams.get('expires'), '').valid,
    false
  );

  harness.session.status = 'Closed';
  assert.equal(
    harness.call('getClientSessionDetails', harness.session.token, url.searchParams.get('access'), url.searchParams.get('expires'), DEVICE_ID).valid,
    false
  );
});

test('preserves registered, unknown, and invalid roll validation', () => {
  const harness = createHarness();
  const { details } = grantFromQr(harness);

  harness.db.getStudentByRollNo = () => ({
    rollNumber: ROLL_NUMBER,
    fullName: 'Registered Student',
    status: 'Active',
    gender: 'Male'
  });
  const registered = harness.call(
    'validateRollNo', ROLL_NUMBER.toLowerCase(), harness.session.token, DEVICE_ID, details.accessGrant
  );
  assert.equal(registered.valid, true);
  assert.equal(registered.exists, true);
  assert.equal(registered.rollNumber, ROLL_NUMBER);
  assert.equal(registered.genderRequired, false);

  harness.db.getStudentByRollNo = () => ({
    rollNumber: ROLL_NUMBER,
    fullName: 'Legacy Student',
    status: 'Active',
    gender: ''
  });
  const legacy = harness.call(
    'validateRollNo', ROLL_NUMBER, harness.session.token, DEVICE_ID, details.accessGrant
  );
  assert.equal(legacy.valid, true);
  assert.equal(legacy.genderRequired, true);
  assert.equal(Object.prototype.hasOwnProperty.call(legacy, 'gender'), false);

  harness.db.getStudentByRollNo = () => ({
    rollNumber: ROLL_NUMBER,
    fullName: 'Noncanonical Student',
    status: 'Active',
    gender: 'male'
  });
  const noncanonical = harness.call(
    'validateRollNo', ROLL_NUMBER, harness.session.token, DEVICE_ID, details.accessGrant
  );
  assert.equal(noncanonical.code, 'INVALID_GENDER');

  harness.db.getStudentByRollNo = () => null;
  const unknown = harness.call(
    'validateRollNo', ROLL_NUMBER, harness.session.token, DEVICE_ID, details.accessGrant
  );
  assert.equal(unknown.valid, true);
  assert.equal(unknown.exists, false);

  harness.db.getStudentByRollNo = () => ({
    rollNumber: ROLL_NUMBER,
    fullName: 'Pending Student',
    status: 'Pending'
  });
  const pending = harness.call(
    'validateRollNo', ROLL_NUMBER, harness.session.token, DEVICE_ID, details.accessGrant
  );
  assert.equal(pending.valid, false);
  assert.match(pending.error, /awaiting administrator approval/i);

  const invalid = harness.call(
    'validateRollNo', 'CS21045', harness.session.token, DEVICE_ID, details.accessGrant
  );
  assert.equal(invalid.valid, false);

  harness.cache.delete(`access-grant:${details.accessGrant}`);
  const expired = harness.call(
    'validateRollNo', ROLL_NUMBER, harness.session.token, DEVICE_ID, details.accessGrant
  );
  assert.equal(expired.valid, false);
  assert.match(expired.error, /expired/i);
});

test('derives and validates the official college email from the roll number', () => {
  const harness = createHarness();

  assert.equal(harness.call('getOfficialEmailForRollNo', ROLL_NUMBER), OFFICIAL_EMAIL);
  assert.equal(harness.call('getOfficialEmailForRollNo', ROLL_NUMBER.toLowerCase()), OFFICIAL_EMAIL);
  assert.equal(harness.call('isValidOfficialEmail', OFFICIAL_EMAIL.toUpperCase(), ROLL_NUMBER), true);
  assert.equal(
    harness.call('isValidOfficialEmail', 'cb.sc.u4cys25049@cb.students.amrita.edu', ROLL_NUMBER),
    false
  );
  assert.equal(harness.call('isValidOfficialEmail', `${ROLL_NUMBER.toLowerCase()}@example.com`, ROLL_NUMBER), false);
});

test('runtime schema validation requires the explicit Gender migration', () => {
  const headers = STUDENT_HEADERS.slice();
  const sheet = {
    getLastColumn: () => headers.length,
    getRange(row, column) {
      if (row === 1 && column === 1) return { getValues: () => [[...headers]] };
       return {};
    }
  };
  const context = vm.createContext({
    console,
    __spreadsheet: { getSheetByName: () => sheet }
  });
  vm.runInContext(
    CONFIG_SOURCE + '\n' + DATABASE_SOURCE + '\ngetAttendanceSpreadsheet = () => __spreadsheet;',
    context
  );

  const result = vm.runInContext('DB.ensureStudentSchema()', context);

  assert.deepEqual([...result], STUDENT_HEADERS);
  headers.pop();
  assert.throws(() => vm.runInContext('DB.ensureStudentSchema()', context), /Gender schema migration/);
});

function createSubmitHarness(options = {}) {
  const checkins = [];
  const studentRows = [];
  const dashboardRows = options.student
    ? [['S.No', 'Name', 'Roll No', '07-08-2026'], [1, options.student.fullName, ROLL_NUMBER, 'A']]
    : [['S.No', 'Name', 'Roll No', '07-08-2026']];
  const marks = [];
  const session = {
    sessionId: 'SES-1',
    token: 'session-token',
    title: 'Weekly Meeting',
    date: new Date('2026-08-07T00:00:00Z'),
    opensAt: new Date(Date.now() - 60_000),
    closesAt: new Date(Date.now() + 60_000),
    status: 'Open'
  };

  const sheets = {
    Students: {
      appendRow: row => studentRows.push(row),
      getRange(row, column) {
        return {
          setValue(value) {
            if (options.failGenderWrite) throw new Error('gender write failed');
            if (options.student && row === options.student.row) options.student.gender = value;
            return this;
          }
        };
      }
    },
    'Attendance Dashboard': {
      appendRow(row) { dashboardRows.push(row); },
      getDataRange: () => ({ getValues: () => dashboardRows.map(row => [...row]) }),
      getLastColumn: () => 4,
      getLastRow: () => dashboardRows.length,
      getRange(row, column) {
        return {
          getNotes: () => column === 4 ? [[session.sessionId]] : [['']],
          getValues: () => row === 1 && column === 4 ? [['07-08-2026']] : [[dashboardRows[row - 1]?.[column - 1]]],
          setValue(value) {
            if (options.failDashboardMark && row > 1 && column === 4) throw new Error('dashboard write failed');
            marks.push({ row, column, value });
            while (dashboardRows[row - 1].length < column) dashboardRows[row - 1].push('');
            dashboardRows[row - 1][column - 1] = value;
            return this;
          }
        };
      }
    },
    Checkins: {
      appendRow: row => checkins.push(row)
    }
  };

  const db = {
    withLock: callback => callback(),
    getSessionByToken: token => token === session.token ? session : null,
    ensureCheckinSchema: () => {},
    ensureStudentSchema: () => [...STUDENT_HEADERS],
    getCheckin: () => options.existingCheckin || null,
    getCheckinByDevice: () => options.deviceCheckin || null,
    getStudentByRollNo: () => options.student || null
  };
  const SpreadsheetApp = {
    getActiveSpreadsheet: () => ({ getSheetByName: name => sheets[name] })
  };
  const harness = createHarness({ db, session, SpreadsheetApp });
  const grant = harness.call('issueAccessGrant_', session.token, DEVICE_ID);
  return { checkins, dashboardRows, grant, harness, marks, options, student: options.student, studentRows };
}

test('records existing-student attendance and stores only the hashed device ID', () => {
  const environment = createSubmitHarness({
    student: { rollNumber: ROLL_NUMBER, fullName: 'Registered Student', status: 'Active', gender: 'Male', row: 2 }
  });
  const result = environment.harness.call(
    'submitAttendance',
    'session-token', ROLL_NUMBER, 'Untrusted Name', '', '', false, DEVICE_ID, '=IMPORTDATA("https://example.test")', environment.grant
  );

  assert.equal(result.success, true);
  assert.equal(environment.checkins.length, 1);
  assert.equal(environment.checkins[0][4], ROLL_NUMBER);
  assert.equal(environment.checkins[0][5], 'Registered Student');
  assert.match(environment.checkins[0][8], /^'=IMPORTDATA/);
  assert.equal(environment.checkins[0][9].length, 64);
  assert.notEqual(environment.checkins[0][9], DEVICE_ID);
  assert.ok(environment.marks.some(mark => mark.column === 4 && mark.value === 'P'));
});

test('registers a new student and records attendance', () => {
  const environment = createSubmitHarness();
  const result = environment.harness.call(
    'submitAttendance',
    'session-token', ROLL_NUMBER, 'New Student', OFFICIAL_EMAIL, 'Male', true, DEVICE_ID, 'test-agent', environment.grant
  );

  assert.equal(result.success, true);
  assert.equal(environment.studentRows.length, 1);
  assert.equal(environment.studentRows[0][1], ROLL_NUMBER);
  assert.equal(environment.studentRows[0][2], 'New Student');
  assert.equal(environment.studentRows[0][7], OFFICIAL_EMAIL);
  assert.equal(environment.studentRows[0][8], 'Male');
  assert.equal(environment.dashboardRows.flat().includes(OFFICIAL_EMAIL), false);
  assert.equal(environment.checkins.flat().includes(OFFICIAL_EMAIL), false);
  assert.equal(environment.checkins.length, 1);
});

test('collects missing Gender once and ignores supplied Gender for a completed profile', () => {
  const legacy = createSubmitHarness({
    student: { rollNumber: ROLL_NUMBER, fullName: 'Legacy Student', status: 'Active', gender: '', row: 2 }
  });
  const collected = legacy.harness.call(
    'submitAttendance',
    'session-token', ROLL_NUMBER, '', '', 'Female', false, DEVICE_ID, 'test-agent', legacy.grant
  );
  assert.equal(collected.success, true);
  assert.equal(legacy.student.gender, 'Female');
  assert.equal(legacy.checkins.length, 1);

  const completed = createSubmitHarness({
    student: { rollNumber: ROLL_NUMBER, fullName: 'Student', status: 'Active', gender: 'Male', row: 2 }
  });
  const ignored = completed.harness.call(
    'submitAttendance',
    'session-token', ROLL_NUMBER, '', '', 'Female', false, DEVICE_ID, 'test-agent', completed.grant
  );
  assert.equal(ignored.success, true);
  assert.equal(completed.student.gender, 'Male');
  assert.equal(completed.checkins.length, 1);
});

test('requires only Male or Female and does not confirm attendance when Gender persistence fails', () => {
  for (const gender of ['', 'Prefer not to say', 'Other']) {
    const environment = createSubmitHarness();
    const result = environment.harness.call(
      'submitAttendance',
      'session-token', ROLL_NUMBER, 'New Student', OFFICIAL_EMAIL, gender,
      true, DEVICE_ID, 'test-agent', environment.grant
    );
    assert.equal(result.success, false);
    assert.match(result.code, /GENDER_REQUIRED|INVALID_GENDER/);
    assert.equal(environment.studentRows.length, 0);
    assert.equal(environment.checkins.length, 0);
  }

  const failed = createSubmitHarness({
    student: { rollNumber: ROLL_NUMBER, fullName: 'Legacy Student', status: 'Active', gender: '', row: 2 },
    failGenderWrite: true
  });
  assert.throws(() => failed.harness.call(
    'submitAttendance',
    'session-token', ROLL_NUMBER, '', '', 'Male', false, DEVICE_ID, 'test-agent', failed.grant
  ), /gender write failed/);
  assert.equal(failed.checkins.length, 0);
});

test('attendance remains unconfirmed when a later write fails after Gender is saved', () => {
  const environment = createSubmitHarness({
    student: { rollNumber: ROLL_NUMBER, fullName: 'Legacy Student', status: 'Active', gender: '', row: 2 },
    failDashboardMark: true
  });
  assert.throws(() => environment.harness.call(
    'submitAttendance',
    'session-token', ROLL_NUMBER, '', '', 'Female', false, DEVICE_ID, 'test-agent', environment.grant
  ), /dashboard write failed/);
  assert.equal(environment.student.gender, 'Female');
  assert.equal(environment.checkins.length, 0);

  environment.options.failDashboardMark = false;
  const retry = environment.harness.call(
    'submitAttendance',
    'session-token', ROLL_NUMBER, '', '', '', false, DEVICE_ID, 'test-agent', environment.grant
  );
  assert.equal(retry.success, true);
  assert.equal(environment.student.gender, 'Female');
  assert.equal(environment.checkins.length, 1);
});

test('rejects first-time registration when official email does not match the roll number', () => {
  const environment = createSubmitHarness();
  const result = environment.harness.call(
    'submitAttendance',
    'session-token', ROLL_NUMBER, 'New Student',
    'cb.sc.u4cys25049@cb.students.amrita.edu', 'Male', true, DEVICE_ID, 'test-agent', environment.grant
  );

  assert.equal(result.success, false);
  assert.match(result.error, /official college email.*matches your roll number/i);
  assert.equal(environment.studentRows.length, 0);
  assert.equal(environment.checkins.length, 0);

  const emailAsName = createSubmitHarness();
  const nameResult = emailAsName.harness.call(
    'submitAttendance',
    'session-token', ROLL_NUMBER, OFFICIAL_EMAIL, OFFICIAL_EMAIL,
    'Male', true, DEVICE_ID, 'test-agent', emailAsName.grant
  );
  assert.equal(nameResult.success, false);
  assert.match(nameResult.error, /valid full name/i);
  assert.equal(emailAsName.studentRows.length, 0);
});

test('blocks duplicate roll and second roll from the same device', () => {
  const duplicate = createSubmitHarness({ existingCheckin: { timestamp: new Date() } });
  const duplicateResult = duplicate.harness.call(
    'submitAttendance',
    'session-token', ROLL_NUMBER, '', '', '', false, DEVICE_ID, 'test-agent', duplicate.grant
  );
  assert.equal(duplicateResult.duplicate, true);
  assert.equal(duplicateResult.sameDevice, false);
  assert.equal(duplicate.checkins.length, 0);

  const sameDeviceDuplicate = createSubmitHarness({ existingCheckin: { timestamp: new Date() } });
  sameDeviceDuplicate.harness.db.getCheckin = () => ({
    timestamp: new Date(),
    deviceHash: sameDeviceDuplicate.harness.call('hashDeviceId', DEVICE_ID)
  });
  const sameDeviceResult = sameDeviceDuplicate.harness.call(
    'submitAttendance',
    'session-token', ROLL_NUMBER, '', '', '', false, DEVICE_ID, 'test-agent', sameDeviceDuplicate.grant
  );
  assert.equal(sameDeviceResult.duplicate, true);
  assert.equal(sameDeviceResult.sameDevice, true);

  const device = createSubmitHarness({ deviceCheckin: { timestamp: new Date(), rollNumber: ROLL_NUMBER } });
  const deviceResult = device.harness.call(
    'submitAttendance',
    'session-token', 'CB.SC.U4CYS25049', '', '', '', false, DEVICE_ID, 'test-agent', device.grant
  );
  assert.equal(deviceResult.deviceBlocked, true);
  assert.equal(device.checkins.length, 0);
});

test('sanitizes spreadsheet-bound text and enforces its length limit', () => {
  const harness = createHarness();

  assert.equal(harness.call('sanitizeSpreadsheetText_', '  +SUM(A1:A2)', 40), "'  +SUM(A1:A2)");
  assert.equal(harness.call('sanitizeSpreadsheetText_', 'agent\nname', 40), 'agent name');
  assert.equal(harness.call('sanitizeSpreadsheetText_', '=123456789', 5), "'=123");
});

test('workbook upgrade neutralizes formulas already stored as user agents', () => {
  let writtenValues = null;
  const headers = [
    'Checkin ID', 'Timestamp', 'Session ID', 'Session Date', 'Roll Number',
    'Full Name', 'Result', 'Source', 'User Agent', 'Device ID'
  ];
  const userAgentRange = {
    getValues: () => [['formula result'], ['normal agent']],
    getFormulas: () => [['=IMPORTDATA("https://example.test")'], ['']],
    setValues: values => { writtenValues = values; }
  };
  const sheet = {
    getLastRow: () => 3,
    getLastColumn: () => headers.length,
    getRange: (row, column) => row === 1 && column === 1
      ? { getValues: () => [headers] }
      : userAgentRange
  };
  const harness = createHarness({
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: () => sheet })
    }
  });

  harness.call('sanitizeExistingCheckinUserAgents_');

  assert.deepEqual(
    JSON.parse(JSON.stringify(writtenValues)),
    [["'=IMPORTDATA(\"https://example.test\")"], ['normal agent']]
  );
});

test('Apps Script JSON API rejects malformed, unsupported, missing-secret, and wrong-secret requests', () => {
  const harness = createHarness();

  assert.deepEqual(harness.post('{'), { success: false, error: 'Request could not be processed.' });
  assert.deepEqual(
    harness.post({ action: 'deleteSession', apiSecret: API_SECRET }),
    { success: false, error: 'Unsupported action.' }
  );
  assert.deepEqual(
    harness.post({ action: 'sessionDetails' }),
    { success: false, error: 'Request could not be processed.' }
  );
  assert.deepEqual(
    harness.post({ action: 'sessionDetails', apiSecret: 'wrong-secret-that-is-still-long-enough' }),
    { success: false, error: 'Request could not be processed.' }
  );
  assert.deepEqual(
    harness.post({ action: 'sessionDetails', apiSecret: API_SECRET }, 'text/plain'),
    { success: false, error: 'Request could not be processed.' }
  );
});

test('Apps Script JSON API dispatches only the supported session-details action', () => {
  const harness = createHarness();
  const qr = harness.issueQr();
  const url = new URL(qr.url);
  const response = harness.post({
    action: 'sessionDetails',
    apiSecret: API_SECRET,
    sessionToken: harness.session.token,
    accessCode: url.searchParams.get('access'),
    accessExpires: url.searchParams.get('expires'),
    deviceId: DEVICE_ID
  });

  assert.equal(response.valid, true);
  assert.ok(response.accessGrant);
});

test('Apps Script JSON API reports workbook configuration failures as non-retryable', () => {
  const harness = createHarness({ console: { error() {}, log() {} } });
  const qr = harness.issueQr();
  const url = new URL(qr.url);
  harness.db.getSessionByToken = () => {
    const error = new Error('Workbook unavailable');
    error.name = 'AttendanceConfigurationError';
    throw error;
  };

  const response = harness.post({
    action: 'sessionDetails',
    apiSecret: API_SECRET,
    sessionToken: harness.session.token,
    accessCode: url.searchParams.get('access'),
    accessExpires: url.searchParams.get('expires'),
    deviceId: DEVICE_ID
  });

  assert.deepEqual(response, {
    success: false,
    error: 'Attendance is not configured correctly. Contact the club administrator.',
    retryable: false,
    configurationError: true
  });
});
