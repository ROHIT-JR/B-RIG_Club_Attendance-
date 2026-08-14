/**
 * Weekly team generation with deterministic Female coverage.
 */

const SHUFFLE_SHEET_NAME_ = 'Shuffle';
const SHUFFLE_HISTORY_SHEET_NAME_ = 'Shuffle History';
const SHUFFLE_HISTORY_HEADERS_ = [
  'Week Key', 'Generated At', 'Group Number', 'Roll Number', 'Full Name', 'Department'
];

function shuffleStudentsIntoGroups() {
  const ui = SpreadsheetApp.getUi();
  try {
    const ss = getAttendanceSpreadsheet();
    const timeZone = getSetting('Time zone') || 'Asia/Kolkata';
    const latestSession = getLatestAttendanceSession_(ss);
    const attendanceContext = getShuffleAttendanceContext_(ss, latestSession, timeZone);
    const presentStudents = getEligibleShuffleStudents_(ss, latestSession, timeZone, attendanceContext);
    const absentStudents = getEligibleAbsentShuffleStudents_(ss, presentStudents, latestSession, timeZone, attendanceContext);
    if (!presentStudents.length && !absentStudents.length) {
      ui.alert('No present or eligible absent students were found for the latest attendance session.');
      return;
    }

    const preferredGroupSize = promptForPreferredGroupSize_(presentStudents.length + absentStudents.length, ui);
    if (preferredGroupSize === null) return;
    showShuffleAbsentSelector_(presentStudents, absentStudents, latestSession, preferredGroupSize, timeZone);
  } catch (error) {
    ui.alert(error.message || 'Latest attendance could not be loaded for Shuffle.');
  }
}

function finalizeShuffleWithAbsent(preferredGroupSize, selectedRolls, expectedSessionId) {
  const ss = getAttendanceSpreadsheet();
  const timeZone = getSetting('Time zone') || 'Asia/Kolkata';
  const generatedAt = new Date();
  const normalizedExpectedSessionId = String(expectedSessionId || '').trim();
  if (!normalizedExpectedSessionId) throw new Error('Attendance session changed. Start Shuffle again.');
  let result;

  try {
    withShuffleLock_(() => {
      const latestSession = getLatestAttendanceSession_(ss);
      if (latestSession.sessionId !== normalizedExpectedSessionId) {
        throw new Error('A newer attendance session is available. Start Shuffle again.');
      }
      const attendanceContext = getShuffleAttendanceContext_(ss, latestSession, timeZone);
      const presentStudents = getEligibleShuffleStudents_(ss, latestSession, timeZone, attendanceContext);
      const absentStudents = getEligibleAbsentShuffleStudents_(ss, presentStudents, latestSession, timeZone, attendanceContext);
      const students = buildFinalShuffleParticipants_(presentStudents, absentStudents, selectedRolls);
      const preferredSize = validatePreferredGroupSize_(preferredGroupSize, students.length);
      if (!students.length) {
        result = { success: true, participantCount: 0, groupCount: 0, empty: true };
        return;
      }
      const groupCount = calculateShuffleGroupCount_(students.length, preferredSize);
      const weekKey = getWeekKey_(generatedAt, timeZone);
      const history = readShuffleHistory_(ss);
      const seed = createShuffleSeed_(
        latestSession.sessionId,
        weekKey,
        students,
        preferredSize,
        groupCount
      );
      const randomFn = createSeededRandom_(seed);
      const groups = buildFemaleCoveredGroups_(students, groupCount, preferredSize, randomFn);
      const metrics = calculateShuffleMetrics_(groups, students);
      validateGeneratedGroups_(groups, students, preferredSize, metrics);

      writeShuffleResultsSafely_(ss, history, groups, weekKey, generatedAt, timeZone, students.length, {
        sessionTitle: latestSession.title,
        attendanceDate: Utilities.formatDate(latestSession.date, timeZone, 'yyyy-MM-dd'),
        presentCount: presentStudents.length,
        adminAddedCount: students.filter(
          student => student.participationSource === 'Admin Added (Absent)'
        ).length,
        preferredGroupSize: preferredSize,
        groupCount,
        seed,
        metrics
      });
      result = {
        success: true,
        participantCount: students.length,
        groupCount
      };
    });
  } catch (error) {
    console.error('Shuffle write failed:', error);
    throw new Error(error && error.message
      ? error.message
      : 'Teams could not be generated. Start Shuffle again.');
  }

  if (result.empty) {
    ss.toast('No participants selected. Existing Shuffle output was not changed.', 'Shuffle empty', 6);
    return result;
  }

  ss.toast(
    `${result.participantCount} students shuffled into ${result.groupCount} balanced teams.`,
    'Shuffle complete',
    6
  );
  return result;
}

function getEligibleShuffleStudents_(spreadsheet, session, timeZone, suppliedContext) {
  const context = suppliedContext || getShuffleAttendanceContext_(spreadsheet, session, timeZone);
  const dashboardData = context.dashboardData;
  const dashboardHeaders = context.dashboardHeaders;
  const nameIndex = dashboardHeaders.indexOf('Name');
  const rollIndex = dashboardHeaders.indexOf('Roll No');
  if (nameIndex === -1 || rollIndex === -1) {
    throw new Error('Attendance Dashboard must contain Name and Roll No headers.');
  }

  const attendanceColumn = context.attendanceColumn;
  const seenRolls = new Set();
  const students = [];
  for (let rowIndex = 1; rowIndex < dashboardData.length; rowIndex++) {
    if (dashboardData[rowIndex][attendanceColumn] !== CONFIG.MARKERS.PRESENT) continue;
    const fullName = String(dashboardData[rowIndex][nameIndex] || '').trim();
    const rollNumber = String(dashboardData[rowIndex][rollIndex] || '').trim().toUpperCase();
    if (!fullName || !rollNumber || seenRolls.has(rollNumber)) continue;
    seenRolls.add(rollNumber);
    students.push({
      rollNumber,
      fullName,
      department: extractDepartmentFromRoll_(rollNumber),
      gender: context.studentMetadata.get(rollNumber)?.gender || '',
      collegeEmail: context.studentMetadata.get(rollNumber)?.collegeEmail || '',
      participationSource: 'Present'
    });
  }
  return students;
}

function getEligibleAbsentShuffleStudents_(spreadsheet, presentStudents, session, timeZone, suppliedContext) {
  const context = suppliedContext || getShuffleAttendanceContext_(spreadsheet, session, timeZone);
  const dashboardData = context.dashboardData;
  const dashboardHeaders = context.dashboardHeaders;
  const dashboardRollIndex = dashboardHeaders.indexOf('Roll No');
  if (dashboardRollIndex === -1) throw new Error('Attendance Dashboard must contain the Roll No header.');
  const attendanceColumn = context.attendanceColumn;
  const absentRolls = new Set();
  for (let rowIndex = 1; rowIndex < dashboardData.length; rowIndex++) {
    if (dashboardData[rowIndex][attendanceColumn] !== CONFIG.MARKERS.ABSENT) continue;
    const rollNumber = String(dashboardData[rowIndex][dashboardRollIndex] || '').trim().toUpperCase();
    if (rollNumber) absentRolls.add(rollNumber);
  }

  const presentRolls = new Set(presentStudents.map(student => student.rollNumber));
  const seenRolls = new Set();
  const absentStudents = [];
  context.studentMetadata.forEach((metadata, rollNumber) => {
    const fullName = metadata.fullName;
    const status = metadata.status;
    if (!rollNumber || !fullName || status !== CONFIG.STATUS.STUDENT.ACTIVE.toUpperCase() ||
        !absentRolls.has(rollNumber) || presentRolls.has(rollNumber) || seenRolls.has(rollNumber)) return;
    seenRolls.add(rollNumber);
    absentStudents.push({
      rollNumber,
      fullName,
      department: extractDepartmentFromRoll_(rollNumber),
      gender: metadata.gender,
      collegeEmail: metadata.collegeEmail,
      participationSource: 'Admin Added (Absent)'
    });
  });
  return absentStudents;
}

function getShuffleAttendanceContext_(spreadsheet, session, timeZone) {
  const dashboard = spreadsheet.getSheetByName(CONFIG.SHEETS.DASHBOARD);
  if (!dashboard) throw new Error('Attendance Dashboard is missing.');
  const dashboardData = dashboard.getDataRange().getValues();
  const dashboardHeaders = dashboardData[0] || [];
  const attendanceColumn = findLatestAttendanceColumn_(dashboard, dashboardHeaders, session, timeZone);
  const dashboardRollIndex = dashboardHeaders.indexOf('Roll No');
  if (dashboardRollIndex === -1) throw new Error('Attendance Dashboard must contain the Roll No header.');
  return {
    dashboard,
    dashboardData,
    dashboardHeaders,
    attendanceColumn,
    studentMetadata: getShuffleStudentMetadata_(spreadsheet)
  };
}

function getShuffleStudentMetadata_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.STUDENTS);
  if (!sheet) throw new Error('Students sheet is missing. Run workbook setup first.');
  const data = sheet.getDataRange().getValues();
  const headers = data[0] || [];
  const rollIndex = headers.indexOf('Roll Number');
  const nameIndex = headers.indexOf('Full Name');
  const statusIndex = headers.indexOf('Status');
  const genderIndex = headers.indexOf(CONFIG.GENDER.HEADER);
  const emailIndex = headers.indexOf('Official Email');
  if ([rollIndex, nameIndex, statusIndex, genderIndex, emailIndex].includes(-1)) {
    throw new Error('Students sheet must contain Roll Number, Full Name, Status, Official Email, and Gender headers.');
  }
  const metadata = new Map();
  for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
    const rollNumber = normalizeRollNo(data[rowIndex][rollIndex]);
    if (!rollNumber) continue;
    const rawGender = String(data[rowIndex][genderIndex] || '');
    const gender = normalizeGender(rawGender);
    if (metadata.has(rollNumber)) throw new Error('Students sheet contains duplicate normalized roll numbers.');
    const rawEmail = String(data[rowIndex][emailIndex] || '').trim();
    const collegeEmail = rawEmail && isValidOfficialEmail(rawEmail, rollNumber)
      ? normalizeOfficialEmail(rawEmail)
      : '';
    metadata.set(rollNumber, {
      fullName: String(data[rowIndex][nameIndex] || '').trim(),
      status: String(data[rowIndex][statusIndex] || '').trim().toUpperCase(),
      gender: rawGender === 'Female' ? 'Female' : gender === 'Male' && rawGender === 'Male' ? 'Male' : '',
      collegeEmail
    });
  }
  return metadata;
}

function buildFinalShuffleParticipants_(presentStudents, eligibleAbsentStudents, selectedRolls) {
  const participants = presentStudents.slice();
  const includedRolls = new Set(participants.map(student => student.rollNumber));
  const eligibleByRoll = new Map(eligibleAbsentStudents.map(student => [student.rollNumber, student]));
  const normalizedSelections = Array.isArray(selectedRolls)
    ? selectedRolls.slice(0, 1000).map(value => String(value || '').trim().toUpperCase())
    : [];
  normalizedSelections.forEach(rollNumber => {
    const student = eligibleByRoll.get(rollNumber);
    if (student && !includedRolls.has(rollNumber)) {
      participants.push(student);
      includedRolls.add(rollNumber);
    }
  });
  return participants;
}

function showShuffleAbsentSelector_(presentStudents, absentStudents, session, preferredGroupSize, timeZone) {
  const selectorData = {
    sessionId: session.sessionId,
    preferredGroupSize,
    presentCount: presentStudents.length,
    sessionTitle: session.title,
    attendanceDate: Utilities.formatDate(session.date, timeZone, 'yyyy-MM-dd'),
    absentStudents: absentStudents.map(student => ({
      rollNumber: student.rollNumber,
      fullName: student.fullName,
      department: student.department
    }))
  };
  const template = HtmlService.createTemplateFromFile('ShuffleAbsentSelector');
  template.selectorDataJson = JSON.stringify(selectorData)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  SpreadsheetApp.getUi().showModalDialog(
    template.evaluate().setWidth(620).setHeight(640),
    'Add absent students (optional)'
  );
}

function getLatestAttendanceSession_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.SESSIONS);
  if (!sheet) throw new Error('Sessions sheet is missing.');
  const data = sheet.getDataRange().getValues();
  const headers = data[0] || [];
  const idIndex = headers.indexOf('Session ID');
  const dateIndex = headers.indexOf('Session Date');
  const titleIndex = headers.indexOf('Session Title');
  if ([idIndex, dateIndex, titleIndex].includes(-1)) {
    throw new Error('Sessions sheet headers are invalid.');
  }
  if (data.length < 2) throw new Error('No attendance session was found.');
  const latestRow = data[data.length - 1];
  const sessionId = String(latestRow[idIndex] || '').trim();
  if (!sessionId) throw new Error('The latest attendance session is invalid.');
  const date = toValidShuffleDate_(latestRow[dateIndex]);
  if (!date) throw new Error('The latest attendance session date is invalid.');
  return {
    sessionId,
    date,
    title: String(latestRow[titleIndex] || '').trim() || 'Attendance session'
  };
}

function findLatestAttendanceColumn_(dashboard, headers, session, timeZone) {
  const notes = dashboard.getRange(1, 1, 1, headers.length).getNotes()[0];
  for (let columnIndex = headers.length - 1; columnIndex >= 0; columnIndex--) {
    if (String(notes[columnIndex] || '').trim() === session.sessionId) return columnIndex;
  }
  throw new Error('The latest attendance session column was not found in Attendance Dashboard.');
}

function toValidShuffleDate_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const date = Object.prototype.toString.call(value) === '[object Date]'
    ? new Date(value.getTime())
    : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function extractDepartmentFromRoll_(rollNumber) {
  const segments = String(rollNumber || '').trim().toUpperCase().split('.');
  for (let index = segments.length - 1; index >= 0; index--) {
    const match = segments[index].match(/([A-Z]{3})\d{5}$/);
    if (match) return match[1];
  }
  return 'UNK';
}

function promptForPreferredGroupSize_(studentCount, ui) {
  const response = ui.prompt(
    'Shuffle Students',
    'Enter the preferred number of members per group:',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return null;
  const value = String(response.getResponseText() || '').trim();
  if (!/^\d+$/.test(value)) {
    ui.alert(`Enter a whole number from 1 to ${studentCount}.`);
    return null;
  }
  const preferredGroupSize = Number(value);
  if (preferredGroupSize < 1 || preferredGroupSize > studentCount) {
    ui.alert(`Enter a whole number from 1 to ${studentCount}.`);
    return null;
  }
  return preferredGroupSize;
}

function validatePreferredGroupSize_(value, participantCount) {
  const normalized = String(value === undefined || value === null ? '' : value).trim();
  if (!/^\d+$/.test(normalized)) throw new Error('Preferred group strength is invalid. Start Shuffle again.');
  const preferredSize = Number(normalized);
  if (preferredSize < 1 || preferredSize > 1000) {
    throw new Error('Preferred group strength is invalid. Start Shuffle again.');
  }
  return preferredSize;
}

function calculateShuffleGroupCount_(studentCount, preferredGroupSize) {
  return studentCount === 0 ? 0 : Math.ceil(studentCount / preferredGroupSize);
}

function getWeekKey_(date, timeZone) {
  const localDate = Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
  const calendarDate = new Date(`${localDate}T12:00:00Z`);
  const daysSinceMonday = (calendarDate.getUTCDay() + 6) % 7;
  calendarDate.setUTCDate(calendarDate.getUTCDate() - daysSinceMonday);
  return Utilities.formatDate(calendarDate, 'UTC', 'yyyy-MM-dd');
}

function readShuffleHistory_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(SHUFFLE_HISTORY_SHEET_NAME_);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0] || [];
  const required = ['Week Key', 'Group Number', 'Roll Number', 'Full Name', 'Department'];
  if (required.some(header => !headers.includes(header))) {
    throw new Error('Shuffle History headers are invalid.');
  }
  return data.slice(1).filter(row => row.some(value => value !== '')).map(row => ({
    weekKey: String(row[headers.indexOf('Week Key')] || '').trim(),
    generatedAt: row[headers.indexOf('Generated At')],
    groupNumber: Number(row[headers.indexOf('Group Number')]),
    rollNumber: String(row[headers.indexOf('Roll Number')] || '').trim().toUpperCase(),
    fullName: String(row[headers.indexOf('Full Name')] || '').trim(),
    department: String(row[headers.indexOf('Department')] || 'UNK').trim().toUpperCase()
  })).filter(row => row.weekKey && Number.isInteger(row.groupNumber) && row.rollNumber);
}

function shuffleArray_(values, randomFn) {
  const shuffled = values.slice();
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(randomFn() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function buildGroupCapacities_(studentCount, groupCount, randomFn) {
  const baseSize = Math.floor(studentCount / groupCount);
  const extraSeats = studentCount % groupCount;
  const capacities = Array(groupCount).fill(baseSize);
  shuffleArray_(Array.from({ length: groupCount }, (_, index) => index), randomFn)
    .slice(0, extraSeats)
    .forEach(index => { capacities[index] += 1; });
  return capacities;
}

function buildFemaleCoveredGroups_(students, groupCount, preferredSize, randomFn) {
  const orderedStudents = students.slice().sort((first, second) =>
    first.rollNumber.localeCompare(second.rollNumber)
  );
  const capacities = buildGroupCapacities_(orderedStudents.length, groupCount, randomFn);
  if (capacities.some(capacity => capacity > preferredSize)) {
    throw new Error('Calculated team capacity exceeds the preferred team size.');
  }
  const groups = capacities.map((capacity, index) => ({ number: index + 1, capacity, students: [] }));
  const femaleParticipants = shuffleArray_(
    orderedStudents.filter(student => student.gender === 'Female'), randomFn
  );
  const assignedRolls = new Set();
  femaleParticipants.slice(0, groupCount).forEach((student, index) => {
    groups[index].students.push(student);
    assignedRolls.add(student.rollNumber);
  });

  const remaining = shuffleArray_(
    orderedStudents.filter(student => !assignedRolls.has(student.rollNumber)), randomFn
  );
  remaining.forEach(student => {
    const available = groups.filter(group => group.students.length < group.capacity);
    if (!available.length) throw new Error('No team capacity remains for a participant.');
    const smallestSize = Math.min(...available.map(group => group.students.length));
    const candidates = available.filter(group => group.students.length === smallestSize);
    const selected = candidates[Math.floor(randomFn() * candidates.length)];
    selected.students.push(student);
  });
  return groups;
}

function createShuffleSeed_(sessionId, weekKey, students, preferredSize, groupCount) {
  const studentFingerprint = students.map(student => [
    student.rollNumber,
    student.participationSource
  ].join(':')).sort().join('|');
  const input = `${sessionId}|${weekKey}|${preferredSize}|${groupCount}|${studentFingerprint}|v3`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createSeededRandom_(seed) {
  let state = parseInt(String(seed || '0'), 16) >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function calculateShuffleMetrics_(groups, students) {
  const nonemptyGroups = groups.filter(group => group.students.length > 0);
  const sizes = nonemptyGroups.map(group => group.students.length);
  const femaleCount = students.filter(student => student.gender === 'Female').length;
  const femaleCoveredTeams = nonemptyGroups.filter(group =>
    group.students.some(student => student.gender === 'Female')
  ).length;
  const femaleCoverageTarget = Math.min(nonemptyGroups.length, femaleCount);
  const missingCollegeEmailCount = students.filter(student => !student.collegeEmail).length;
  const warnings = [];
  if (femaleCoveredTeams < femaleCoverageTarget) warnings.push('Female coverage did not reach its feasible target.');
  if (femaleCount < nonemptyGroups.length) {
    warnings.push(`${nonemptyGroups.length - femaleCount} teams could not receive a Female participant because only ${femaleCount} were available.`);
  }
  if (missingCollegeEmailCount) warnings.push(`${missingCollegeEmailCount} participants have a missing or invalid College Email.`);
  return {
    minSize: sizes.length ? Math.min(...sizes) : 0,
    maxSize: sizes.length ? Math.max(...sizes) : 0,
    expectedCapacities: groups.map(group => group.capacity),
    femaleCount,
    femaleCoveredTeams,
    femaleCoverageTarget,
    missingCollegeEmailCount,
    warnings
  };
}

function validateGeneratedGroups_(groups, students, preferredSize, reportedMetrics) {
  if (!Array.isArray(groups) || !groups.length) throw new Error('No groups were generated.');
  const assigned = groups.flatMap(group => group.students.map(student => student.rollNumber));
  const expected = students.map(student => student.rollNumber);
  const sizes = groups.map(group => group.students.length);
  const expectedGroupCount = Math.ceil(students.length / preferredSize);
  if (groups.length !== expectedGroupCount ||
      assigned.length !== expected.length || new Set(assigned).size !== expected.length ||
      expected.some(rollNumber => !assigned.includes(rollNumber)) ||
      Math.max(...sizes) - Math.min(...sizes) > 1 ||
      groups.some(group => group.students.length !== group.capacity) ||
      groups.some(group => group.students.length > preferredSize)) {
    throw new Error('Generated groups failed validation.');
  }
  const actualMetrics = calculateShuffleMetrics_(groups, students);
  if (actualMetrics.femaleCoveredTeams !== actualMetrics.femaleCoverageTarget ||
      reportedMetrics.femaleCount !== actualMetrics.femaleCount ||
      reportedMetrics.femaleCoveredTeams !== actualMetrics.femaleCoveredTeams ||
      reportedMetrics.femaleCoverageTarget !== actualMetrics.femaleCoverageTarget ||
      reportedMetrics.missingCollegeEmailCount !== actualMetrics.missingCollegeEmailCount ||
      reportedMetrics.minSize !== actualMetrics.minSize ||
      reportedMetrics.maxSize !== actualMetrics.maxSize ||
      JSON.stringify(reportedMetrics.expectedCapacities) !== JSON.stringify(actualMetrics.expectedCapacities)) {
    throw new Error('Generated team metrics failed validation.');
  }
  return true;
}

function getOrCreateShuffleSheet_(spreadsheet) {
  return spreadsheet.getSheetByName(SHUFFLE_SHEET_NAME_) || spreadsheet.insertSheet(SHUFFLE_SHEET_NAME_);
}

function getOrCreateShuffleHistorySheet_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(SHUFFLE_HISTORY_SHEET_NAME_) ||
    spreadsheet.insertSheet(SHUFFLE_HISTORY_SHEET_NAME_);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, SHUFFLE_HISTORY_HEADERS_.length).setValues([SHUFFLE_HISTORY_HEADERS_]);
  return sheet;
}

function writeShuffleResultsSafely_(spreadsheet, history, groups, weekKey, generatedAt, timeZone, totalStudents, shuffleInfo) {
  const existingShuffle = spreadsheet.getSheetByName(SHUFFLE_SHEET_NAME_);
  const existingHistory = spreadsheet.getSheetByName(SHUFFLE_HISTORY_SHEET_NAME_);
  const backupSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  const backups = [];

  try {
    if (existingShuffle) {
      const backup = {
        originalName: SHUFFLE_SHEET_NAME_,
        originalSheet: existingShuffle,
        hidden: existingShuffle.isSheetHidden(),
        sheet: existingShuffle.copyTo(spreadsheet)
      };
      backups.push(backup);
      backup.sheet.setName(`Shuffle Backup ${backupSuffix}`).hideSheet();
    }
    if (existingHistory) {
      const backup = {
        originalName: SHUFFLE_HISTORY_SHEET_NAME_,
        originalSheet: existingHistory,
        hidden: existingHistory.isSheetHidden(),
        sheet: existingHistory.copyTo(spreadsheet)
      };
      backups.push(backup);
      backup.sheet.setName(`History Backup ${backupSuffix}`).hideSheet();
    }
  } catch (error) {
    backups.forEach(backup => spreadsheet.deleteSheet(backup.sheet));
    throw error;
  }

  try {
    const shuffleSheet = getOrCreateShuffleSheet_(spreadsheet);
    const historySheet = getOrCreateShuffleHistorySheet_(spreadsheet);
    writeShuffleSheet_(shuffleSheet, groups, weekKey, generatedAt, timeZone, totalStudents, shuffleInfo);
    replaceCurrentWeekHistory_(historySheet, history, weekKey, generatedAt, groups);
    spreadsheet.setActiveSheet(shuffleSheet);
  } catch (error) {
    restoreShuffleBackups_(spreadsheet, backups);
    throw error;
  }

  backups.forEach(backup => {
    try {
      spreadsheet.deleteSheet(backup.sheet);
    } catch (error) {
      console.error('Could not remove a completed Shuffle backup:', error);
    }
  });
}

function restoreShuffleBackups_(spreadsheet, backups) {
  const names = [SHUFFLE_SHEET_NAME_, SHUFFLE_HISTORY_SHEET_NAME_];
  const backedNames = new Set(backups.map(backup => backup.originalName));
  names.forEach(name => {
    const current = spreadsheet.getSheetByName(name);
    if (current && !backedNames.has(name)) spreadsheet.deleteSheet(current);
  });
  backups.forEach(backup => {
    restoreShuffleSheetInPlace_(backup.originalSheet, backup.sheet);
    if (backup.hidden) backup.originalSheet.hideSheet();
    else backup.originalSheet.showSheet();
    spreadsheet.deleteSheet(backup.sheet);
  });
}

function restoreShuffleSheetInPlace_(originalSheet, backupSheet) {
  if (originalSheet.getLastRow() > 0 && originalSheet.getLastColumn() > 0) {
    originalSheet.getDataRange().breakApart();
  }
  originalSheet.clear();
  const sourceRange = backupSheet.getDataRange();
  const rowCount = sourceRange.getNumRows();
  const columnCount = sourceRange.getNumColumns();
  sourceRange.copyTo(originalSheet.getRange(1, 1, rowCount, columnCount));
  sourceRange.getMergedRanges().forEach(range => {
    originalSheet.getRange(range.getRow(), range.getColumn(), range.getNumRows(), range.getNumColumns()).merge();
  });
  originalSheet.setFrozenRows(backupSheet.getFrozenRows());
  originalSheet.setFrozenColumns(backupSheet.getFrozenColumns());
  for (let column = 1; column <= columnCount; column++) {
    originalSheet.setColumnWidth(column, backupSheet.getColumnWidth(column));
  }
  for (let row = 1; row <= rowCount; row++) {
    originalSheet.setRowHeight(row, backupSheet.getRowHeight(row));
  }
}

function replaceCurrentWeekHistory_(sheet, existingHistory, weekKey, generatedAt, groups) {
  const retained = existingHistory.filter(row => row.weekKey !== weekKey).map(row => [
    row.weekKey, row.generatedAt, row.groupNumber, row.rollNumber, row.fullName, row.department
  ]);
  const current = [];
  groups.forEach(group => group.students.forEach(student => current.push([
    weekKey, generatedAt, group.number, student.rollNumber, student.fullName, student.department
  ])));
  const rows = [SHUFFLE_HISTORY_HEADERS_, ...retained, ...current];
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, SHUFFLE_HISTORY_HEADERS_.length).setValues(rows);
  sheet.getRange(1, 1, 1, SHUFFLE_HISTORY_HEADERS_.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function writeShuffleSheet_(sheet, groups, weekKey, generatedAt, timeZone, totalStudents, shuffleInfo) {
  const info = shuffleInfo || {};
  const metrics = info.metrics || calculateShuffleMetrics_(groups, groups.flatMap(group => group.students));
  const rows = [
    ['B-RIG Weekly Team Shuffle', '', '', '', '', ''],
    ['Attendance Session', info.sessionTitle || 'Attendance session', '', '', '', ''],
    ['Attendance Date', info.attendanceDate || '', '', '', '', ''],
    ['Generated At', Utilities.formatDate(generatedAt, timeZone, 'yyyy-MM-dd HH:mm'), '', '', '', ''],
    ['Week', weekKey, '', '', '', ''],
    ['Latest Present Students', Number.isFinite(info.presentCount) ? info.presentCount : totalStudents, '', '', '', ''],
    ['Admin Added (Absent)', Number(info.adminAddedCount) || 0, '', '', '', ''],
    ['Total Participants', totalStudents, '', '', '', ''],
    ['Preferred Team Size', info.preferredGroupSize || '', '', '', '', ''],
    ['Teams Created', groups.length, '', '', '', ''],
    ['Expected Team Capacities', metrics.expectedCapacities.join(', '), '', '', '', ''],
    ['Team Size Range', `${metrics.minSize}-${metrics.maxSize}`, '', '', '', ''],
    ['Female Participants', metrics.femaleCount, '', '', '', ''],
    ['Female-Covered Teams', `${metrics.femaleCoveredTeams}/${groups.length}`, '', '', '', ''],
    ['Female Coverage Target', `${metrics.femaleCoverageTarget}/${groups.length}`, '', '', '', ''],
    ['Students with Missing College Email', metrics.missingCollegeEmailCount, '', '', '', ''],
    ['Random Seed (inputs must be unchanged)', info.seed || '', '', '', '', ''],
  ];
  if (metrics.warnings.length) {
    rows.push(['Warnings', metrics.warnings.join(' '), '', '', '', '']);
  }
  rows.push(['', '', '', '', '', '']);
  const groupStarts = [];
  groups.forEach(group => {
    groupStarts.push(rows.length + 1);
    rows.push([`GROUP ${group.number}`, '', '', '', '', '']);
    rows.push(['S.No', 'Name', 'Roll Number', 'Department', 'College Email', 'Participation Source']);
    group.students.forEach((student, index) => rows.push([
      index + 1, student.fullName, student.rollNumber, student.department,
      student.collegeEmail || 'Missing',
      student.participationSource || 'Present'
    ]));
    const groupFemaleCovered = group.students.some(student => student.gender === 'Female') ? 'Yes' : 'No';
    const presentCount = group.students.filter(student => student.participationSource === 'Present').length;
    const emails = [...new Set(group.students.map(student => student.collegeEmail).filter(Boolean))];
    rows.push([
      `Team size: ${group.students.length}/${group.capacity} | Female coverage: ${groupFemaleCovered} | Participation: ${presentCount} Present | ${group.students.length - presentCount} Admin Added (Absent) | College emails available: ${emails.length}/${group.students.length}`,
      '', '', '', '', ''
    ]);
    rows.push([`Team mailing list: ${emails.join(', ')}`, '', '', '', '', '']);
    rows.push(['', '', '', '', '', '']);
  });

  if (sheet.getLastRow() > 0 && sheet.getLastColumn() > 0) {
    sheet.getDataRange().breakApart();
  }
  sheet.clear();
  sheet.getRange(1, 1, rows.length, 6).setValues(rows);
  formatShuffleSheet_(sheet, rows.length, groupStarts, groups);
}

function formatShuffleSheet_(sheet, rowCount, groupStarts, groups) {
  sheet.setFrozenRows(2);
  sheet.getRange(1, 1, 1, 6).merge().setFontWeight('bold').setFontSize(16)
    .setBackground('#0b3d38').setFontColor('#ffffff').setHorizontalAlignment('center');
  if (groupStarts.length && groupStarts[0] > 3) {
    sheet.getRange(2, 1, groupStarts[0] - 3, 6).setBackground('#eef7f5');
    sheet.getRange(2, 1, groupStarts[0] - 3, 1).setFontWeight('bold');
  }
  groupStarts.forEach((startRow, index) => {
    sheet.getRange(startRow, 1, 1, 6).merge().setFontWeight('bold')
      .setBackground('#146c5c').setFontColor('#ffffff');
    sheet.getRange(startRow + 1, 1, 1, 6).setFontWeight('bold').setBackground('#b8ddd5');
    const memberCount = groups[index].students.length;
    if (memberCount) sheet.getRange(startRow + 2, 1, memberCount, 6).setBorder(true, true, true, true, true, true);
    sheet.getRange(startRow + memberCount + 2, 1, 1, 6).merge()
      .setFontStyle('italic').setBackground('#eef7f5');
    sheet.getRange(startRow + memberCount + 3, 1, 1, 6).merge()
      .setFontStyle('italic').setBackground('#eef7f5');
  });
  sheet.getRange(1, 1, rowCount, 6).setVerticalAlignment('middle');
  sheet.getRange(1, 1, rowCount, 1).setHorizontalAlignment('center');
  sheet.getRange(1, 4, rowCount, 1).setHorizontalAlignment('center');
  sheet.getRange(1, 5, rowCount, 1).setHorizontalAlignment('center');
  sheet.getRange(1, 6, rowCount, 1).setHorizontalAlignment('center');
  sheet.getRange(1, 2, rowCount, 1).setWrap(true);
  sheet.setColumnWidth(1, 90);
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidth(3, 190);
  sheet.setColumnWidth(4, 90);
  sheet.setColumnWidth(5, 260);
  sheet.setColumnWidth(6, 170);
}

function withShuffleLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}
