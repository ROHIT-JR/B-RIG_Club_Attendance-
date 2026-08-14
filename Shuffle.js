/**
 * Weekly interdisciplinary team generation with repeat-pair avoidance.
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
    const presentStudents = getEligibleShuffleStudents_(ss, latestSession, timeZone);
    const absentStudents = getEligibleAbsentShuffleStudents_(ss, presentStudents, latestSession, timeZone);
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
  let snapshot;
  let result;

  try {
    withAttendanceSnapshotLock_(() => {
      const latestSession = getLatestAttendanceSession_(ss);
      if (latestSession.sessionId !== normalizedExpectedSessionId) {
        throw new Error('A newer attendance session is available. Start Shuffle again.');
      }
      const presentStudents = getEligibleShuffleStudents_(ss, latestSession, timeZone);
      const absentStudents = getEligibleAbsentShuffleStudents_(ss, presentStudents, latestSession, timeZone);
      const students = buildFinalShuffleParticipants_(presentStudents, absentStudents, selectedRolls);
      if (!students.length) throw new Error('Select at least one eligible student before generating teams.');
      const preferredSize = validatePreferredGroupSize_(preferredGroupSize, students.length);
      const newMemberCount = students.filter(student => student.isNewMember).length;
      const normalGroupCount = Math.ceil(students.length / preferredSize);
      const groupCount = calculateShuffleGroupCount_(students.length, preferredSize, newMemberCount);
      snapshot = {
        latestSession,
        presentStudents,
        students,
        preferredSize,
        newMemberCount,
        normalGroupCount,
        groupCount
      };
    });

    withShuffleLock_(() => {
      const weekKey = getWeekKey_(generatedAt, timeZone);
      const history = readShuffleHistory_(ss);
      const currentPairHistory = buildPairHistory_(history, weekKey);
      const groups = buildInterdisciplinaryGroups_(
        snapshot.students,
        snapshot.groupCount,
        currentPairHistory.pairCounts,
        currentPairHistory.recentPairs,
        Math.random
      );
      validateGeneratedGroups_(groups, snapshot.students);

      writeShuffleResultsSafely_(ss, history, groups, weekKey, generatedAt, timeZone, snapshot.students.length, {
        sessionTitle: snapshot.latestSession.title,
        attendanceDate: Utilities.formatDate(snapshot.latestSession.date, timeZone, 'yyyy-MM-dd'),
        presentCount: snapshot.presentStudents.length,
        newMemberCount: snapshot.newMemberCount,
        adminAddedCount: snapshot.students.filter(
          student => student.participationSource === 'Admin Added (Absent)'
        ).length,
        preferredGroupSize: snapshot.preferredSize,
        normalGroupCount: snapshot.normalGroupCount,
        groupCount: snapshot.groupCount
      });
      result = {
        success: true,
        participantCount: snapshot.students.length,
        groupCount: snapshot.groupCount
      };
    });
  } catch (error) {
    console.error('Shuffle write failed:', error);
    throw new Error(error && error.message
      ? error.message
      : 'Teams could not be generated. Start Shuffle again.');
  }

  ss.toast(
    `${result.participantCount} students shuffled into ${result.groupCount} interdisciplinary groups.`,
    'Shuffle complete',
    6
  );
  return result;
}

function getEligibleShuffleStudents_(spreadsheet, session, timeZone) {
  const dashboard = spreadsheet.getSheetByName(CONFIG.SHEETS.DASHBOARD);
  if (!dashboard) throw new Error('Attendance Dashboard is missing.');
  const dashboardData = dashboard.getDataRange().getValues();
  const dashboardHeaders = dashboardData[0] || [];
  const nameIndex = dashboardHeaders.indexOf('Name');
  const rollIndex = dashboardHeaders.indexOf('Roll No');
  if (nameIndex === -1 || rollIndex === -1) {
    throw new Error('Attendance Dashboard must contain Name and Roll No headers.');
  }

  const attendanceColumn = findLatestAttendanceColumn_(dashboard, dashboardHeaders, session, timeZone);
  const registeredDates = getShuffleRegistrationDates_(spreadsheet);
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
      isNewMember: isSameShuffleDate_(registeredDates.get(rollNumber), session.date, timeZone),
      participationSource: 'Present'
    });
  }
  return students;
}

function getEligibleAbsentShuffleStudents_(spreadsheet, presentStudents, session, timeZone) {
  const dashboard = spreadsheet.getSheetByName(CONFIG.SHEETS.DASHBOARD);
  if (!dashboard) throw new Error('Attendance Dashboard is missing.');
  const dashboardData = dashboard.getDataRange().getValues();
  const dashboardHeaders = dashboardData[0] || [];
  const dashboardRollIndex = dashboardHeaders.indexOf('Roll No');
  if (dashboardRollIndex === -1) throw new Error('Attendance Dashboard must contain the Roll No header.');
  const attendanceColumn = findLatestAttendanceColumn_(dashboard, dashboardHeaders, session, timeZone);
  const absentRolls = new Set();
  for (let rowIndex = 1; rowIndex < dashboardData.length; rowIndex++) {
    if (dashboardData[rowIndex][attendanceColumn] !== CONFIG.MARKERS.ABSENT) continue;
    const rollNumber = String(dashboardData[rowIndex][dashboardRollIndex] || '').trim().toUpperCase();
    if (rollNumber) absentRolls.add(rollNumber);
  }

  const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.STUDENTS);
  if (!sheet) throw new Error('Students sheet is missing. Run workbook setup first.');
  const data = sheet.getDataRange().getValues();
  const headers = data[0] || [];
  const rollIndex = headers.indexOf('Roll Number');
  const nameIndex = headers.indexOf('Full Name');
  const statusIndex = headers.indexOf('Status');
  const registeredIndex = headers.indexOf('Registered At');
  if ([rollIndex, nameIndex, statusIndex].includes(-1)) {
    throw new Error('Students sheet must contain Roll Number, Full Name, and Status headers.');
  }

  const presentRolls = new Set(presentStudents.map(student => student.rollNumber));
  const seenRolls = new Set();
  const absentStudents = [];
  for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
    const rollNumber = String(data[rowIndex][rollIndex] || '').trim().toUpperCase();
    const fullName = String(data[rowIndex][nameIndex] || '').trim();
    const status = String(data[rowIndex][statusIndex] || '').trim().toUpperCase();
    if (!rollNumber || !fullName || status !== CONFIG.STATUS.STUDENT.ACTIVE.toUpperCase() ||
        !absentRolls.has(rollNumber) || presentRolls.has(rollNumber) || seenRolls.has(rollNumber)) continue;
    seenRolls.add(rollNumber);
    absentStudents.push({
      rollNumber,
      fullName,
      department: extractDepartmentFromRoll_(rollNumber),
      isNewMember: isSameShuffleDate_(
        registeredIndex === -1 ? null : data[rowIndex][registeredIndex], session.date, timeZone
      ),
      participationSource: 'Admin Added (Absent)'
    });
  }
  return absentStudents;
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
      department: student.department,
      memberType: student.isNewMember ? 'New' : 'Existing'
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

function getShuffleRegistrationDates_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.STUDENTS);
  if (!sheet) throw new Error('Students sheet is missing. Run workbook setup first.');
  const data = sheet.getDataRange().getValues();
  const headers = data[0] || [];
  const rollIndex = headers.indexOf('Roll Number');
  const registeredIndex = headers.indexOf('Registered At');
  if (rollIndex === -1) throw new Error('Students sheet must contain the Roll Number header.');
  const registeredDates = new Map();
  for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
    const rollNumber = String(data[rowIndex][rollIndex] || '').trim().toUpperCase();
    if (rollNumber && !registeredDates.has(rollNumber)) {
      registeredDates.set(rollNumber, registeredIndex === -1 ? null : data[rowIndex][registeredIndex]);
    }
  }
  return registeredDates;
}

function toValidShuffleDate_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const date = Object.prototype.toString.call(value) === '[object Date]'
    ? new Date(value.getTime())
    : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isSameShuffleDate_(first, second, timeZone) {
  const firstDate = toValidShuffleDate_(first);
  const secondDate = toValidShuffleDate_(second);
  if (!firstDate || !secondDate) return false;
  return Utilities.formatDate(firstDate, timeZone, 'yyyy-MM-dd') ===
    Utilities.formatDate(secondDate, timeZone, 'yyyy-MM-dd');
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

function calculateShuffleGroupCount_(studentCount, preferredGroupSize, newMemberCount) {
  return Math.max(Math.ceil(studentCount / preferredGroupSize), newMemberCount);
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

function buildPairHistory_(historyRows, currentWeekKey) {
  const earlierRows = historyRows.filter(row => row.weekKey && row.weekKey < currentWeekKey);
  const previousWeeks = [...new Set(earlierRows.map(row => row.weekKey))].sort();
  const recentWeekKey = previousWeeks.length ? previousWeeks[previousWeeks.length - 1] : '';
  const pairCounts = new Map();
  const recentPairs = new Set();
  const teams = new Map();

  earlierRows.forEach(row => {
    const teamKey = `${row.weekKey}\u0000${row.groupNumber}`;
    if (!teams.has(teamKey)) teams.set(teamKey, []);
    teams.get(teamKey).push(row.rollNumber);
  });

  teams.forEach((rollNumbers, teamKey) => {
    const uniqueRolls = [...new Set(rollNumbers)].sort();
    const weekKey = teamKey.split('\u0000', 1)[0];
    for (let first = 0; first < uniqueRolls.length; first++) {
      for (let second = first + 1; second < uniqueRolls.length; second++) {
        const key = shufflePairKey_(uniqueRolls[first], uniqueRolls[second]);
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        if (weekKey === recentWeekKey) recentPairs.add(key);
      }
    }
  });
  return { pairCounts, recentPairs, recentWeekKey };
}

function shufflePairKey_(firstRoll, secondRoll) {
  return firstRoll < secondRoll
    ? `${firstRoll}\u0000${secondRoll}`
    : `${secondRoll}\u0000${firstRoll}`;
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

function buildInterdisciplinaryGroups_(students, groupCount, pairCounts, recentPairs, randomFn) {
  const attempts = Math.max(20, Math.min(50, students.length * 2));
  let bestGroups = null;
  let bestScore = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const capacities = buildGroupCapacities_(students.length, groupCount, randomFn);
    const groups = capacities.map((capacity, index) => ({ number: index + 1, capacity, students: [] }));
    const newMembers = shuffleArray_(students.filter(student => student.isNewMember === true), randomFn);
    const seedGroups = shuffleArray_(groups, randomFn)
      .sort((first, second) => second.capacity - first.capacity);
    newMembers.forEach((student, index) => {
      seedGroups[index].students.push(student);
    });

    const buckets = new Map();
    students.filter(student => student.isNewMember !== true).forEach(student => {
      if (!buckets.has(student.department)) buckets.set(student.department, []);
      buckets.get(student.department).push(student);
    });
    const departments = shuffleArray_([...buckets.keys()], randomFn)
      .sort((first, second) => buckets.get(second).length - buckets.get(first).length);

    departments.forEach(department => {
      shuffleArray_(buckets.get(department), randomFn).forEach(student => {
        const candidates = groups.filter(group => group.students.length < group.capacity);
        const scored = candidates.map(group => scoreStudentPlacement_(student, group, pairCounts, recentPairs, randomFn));
        scored.sort((first, second) => compareShuffleScores_(first.score, second.score));
        const bestScoreForStudent = scored[0].score;
        const bestCandidates = scored.filter(candidate => compareShuffleScores_(candidate.score, bestScoreForStudent) === 0);
        bestCandidates[Math.floor(randomFn() * bestCandidates.length)].group.students.push(student);
      });
    });

    const candidateScore = scoreCandidateGroups_(groups, pairCounts, recentPairs);
    if (bestScore === null || compareShuffleScores_(candidateScore, bestScore) < 0) {
      bestScore = candidateScore;
      bestGroups = groups;
    }
  }
  if (!bestGroups) throw new Error('No candidate grouping could be generated.');
  return bestGroups;
}

function scoreStudentPlacement_(student, group, pairCounts, recentPairs, randomFn) {
  const sameDepartmentCount = group.students.filter(member => member.department === student.department).length;
  let recentRepeatCount = 0;
  let historicalPairCount = 0;
  group.students.forEach(member => {
    const key = shufflePairKey_(student.rollNumber, member.rollNumber);
    if (recentPairs.has(key)) recentRepeatCount += 1;
    historicalPairCount += pairCounts.get(key) || 0;
  });
  const remainingAfterPlacement = group.capacity - group.students.length - 1;
  const mentoringPriority = group.students.length === 1 && group.students[0].isNewMember === true ? -1 : 0;
  return {
    group,
    score: [sameDepartmentCount, recentRepeatCount, historicalPairCount, mentoringPriority, -remainingAfterPlacement],
    tieBreaker: randomFn()
  };
}

function scoreCandidateGroups_(groups, pairCounts, recentPairs) {
  let departmentPairs = 0;
  let recentRepeats = 0;
  let historicalRepeats = 0;
  let singletonNewMembers = 0;
  groups.forEach(group => {
    if (group.students.length === 1 && group.students[0].isNewMember === true) singletonNewMembers += 1;
    const departmentCounts = {};
    group.students.forEach(student => {
      departmentCounts[student.department] = (departmentCounts[student.department] || 0) + 1;
    });
    Object.values(departmentCounts).forEach(count => { departmentPairs += count * (count - 1) / 2; });
    for (let first = 0; first < group.students.length; first++) {
      for (let second = first + 1; second < group.students.length; second++) {
        const key = shufflePairKey_(group.students[first].rollNumber, group.students[second].rollNumber);
        if (recentPairs.has(key)) recentRepeats += 1;
        historicalRepeats += pairCounts.get(key) || 0;
      }
    }
  });
  return [departmentPairs, recentRepeats, historicalRepeats, singletonNewMembers];
}

function compareShuffleScores_(first, second) {
  for (let index = 0; index < Math.max(first.length, second.length); index++) {
    const difference = (first[index] || 0) - (second[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function validateGeneratedGroups_(groups, students) {
  if (!Array.isArray(groups) || !groups.length) throw new Error('No groups were generated.');
  const assigned = groups.flatMap(group => group.students.map(student => student.rollNumber));
  const expected = students.map(student => student.rollNumber);
  const sizes = groups.map(group => group.students.length);
  if (assigned.length !== expected.length || new Set(assigned).size !== expected.length ||
      expected.some(rollNumber => !assigned.includes(rollNumber)) ||
      Math.max(...sizes) - Math.min(...sizes) > 1 ||
      groups.some(group => group.students.length !== group.capacity) ||
      groups.some(group => group.students.filter(student => student.isNewMember === true).length > 1)) {
    throw new Error('Generated groups failed validation.');
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
        hidden: existingShuffle.isSheetHidden(),
        sheet: existingShuffle.copyTo(spreadsheet)
      };
      backups.push(backup);
      backup.sheet.setName(`Shuffle Backup ${backupSuffix}`).hideSheet();
    }
    if (existingHistory) {
      const backup = {
        originalName: SHUFFLE_HISTORY_SHEET_NAME_,
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
  names.forEach(name => {
    const current = spreadsheet.getSheetByName(name);
    if (current) spreadsheet.deleteSheet(current);
  });
  backups.forEach(backup => {
    backup.sheet.setName(backup.originalName);
    if (!backup.hidden) backup.sheet.showSheet();
  });
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
  const rows = [
    ['B-RIG Weekly Interdisciplinary Team Shuffle', '', '', '', '', ''],
    ['Attendance Session', info.sessionTitle || 'Attendance session', '', '', '', ''],
    ['Attendance Date', info.attendanceDate || '', '', '', '', ''],
    ['Generated', Utilities.formatDate(generatedAt, timeZone, 'yyyy-MM-dd HH:mm'), '', '', '', ''],
    ['Week', weekKey, '', '', '', ''],
    ['Students Present', Number.isFinite(info.presentCount) ? info.presentCount : totalStudents, '', '', '', ''],
    ['Final Participants', totalStudents, '', '', '', ''],
    ['Admin Added (Absent)', Number(info.adminAddedCount) || 0, '', '', '', ''],
    ['New Members', Number(info.newMemberCount) || 0, '', '', '', ''],
    ['Preferred Group Strength', info.preferredGroupSize || '', '', '', '', ''],
    ['Groups Created', groups.length, '', '', '', '']
  ];
  if (info.groupCount > info.normalGroupCount) {
    rows.push(['Groups increased to keep new members in separate teams.', '', '', '', '', '']);
  }
  if (Number(info.newMemberCount) === totalStudents) {
    rows.push(['All participants are new members, so experienced-member mentoring could not be provided.', '', '', '', '', '']);
  }
  rows.push(['', '', '', '', '', '']);
  const groupStarts = [];
  groups.forEach(group => {
    groupStarts.push(rows.length + 1);
    rows.push([`GROUP ${group.number}`, '', '', '', '', '']);
    rows.push(['S.No', 'Name', 'Roll No', 'Dept', 'Member', 'Participation Source']);
    group.students.forEach((student, index) => rows.push([
      index + 1, student.fullName, student.rollNumber, student.department,
      student.isNewMember === true ? 'New' : 'Existing',
      student.participationSource || 'Present'
    ]));
    const counts = {};
    group.students.forEach(student => { counts[student.department] = (counts[student.department] || 0) + 1; });
    const summary = Object.keys(counts).sort().map(department => `${department} ${counts[department]}`).join(' | ');
    rows.push([`Departments: ${summary}`, '', '', '', '', '']);
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
  sheet.setColumnWidth(5, 100);
  sheet.setColumnWidth(6, 170);
}

function withShuffleLock_(callback) {
  const lock = LockService.getDocumentLock() || LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function withAttendanceSnapshotLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}
