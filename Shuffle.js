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
  let snapshot;
  let result;

  try {
    withAttendanceSnapshotLock_(() => {
      const latestSession = getLatestAttendanceSession_(ss);
      if (latestSession.sessionId !== normalizedExpectedSessionId) {
        throw new Error('A newer attendance session is available. Start Shuffle again.');
      }
      const attendanceContext = getShuffleAttendanceContext_(ss, latestSession, timeZone);
      const presentStudents = getEligibleShuffleStudents_(ss, latestSession, timeZone, attendanceContext);
      const absentStudents = getEligibleAbsentShuffleStudents_(ss, presentStudents, latestSession, timeZone, attendanceContext);
      const students = buildFinalShuffleParticipants_(presentStudents, absentStudents, selectedRolls);
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

    if (!snapshot.students.length) {
      ss.toast('No participants selected. Existing Shuffle output was not changed.', 'Shuffle empty', 6);
      return { success: true, participantCount: 0, groupCount: 0, empty: true };
    }

    withShuffleLock_(() => {
      const weekKey = getWeekKey_(generatedAt, timeZone);
      const history = readShuffleHistory_(ss);
      const currentPairHistory = buildPairHistory_(history, weekKey);
      const seed = createShuffleSeed_(
        snapshot.latestSession.sessionId,
        weekKey,
        snapshot.students,
        snapshot.preferredSize,
        snapshot.groupCount,
        currentPairHistory
      );
      const randomFn = createSeededRandom_(seed);
      const groups = snapshot.students.length
        ? buildInterdisciplinaryGroups_(
          snapshot.students,
          snapshot.groupCount,
          currentPairHistory.pairCounts,
          currentPairHistory.recentPairs,
          randomFn
        )
        : [];
      if (snapshot.students.length) validateGeneratedGroups_(groups, snapshot.students);
      const metrics = calculateShuffleMetrics_(groups, snapshot.students);

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
        groupCount: snapshot.groupCount,
        seed,
        metrics
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
      isNewMember: !context.priorPresentRolls.has(rollNumber),
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
      isNewMember: !context.priorPresentRolls.has(rollNumber),
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
  const notes = dashboard.getRange(1, 1, 1, dashboardHeaders.length).getNotes()[0];
  const priorSessionIds = getPriorShuffleSessionIds_(spreadsheet, session.sessionId);
  const priorColumns = notes
    .map((note, index) => priorSessionIds.has(String(note || '').trim()) ? index : -1)
    .filter(index => index !== -1 && index !== attendanceColumn);
  const dashboardRollIndex = dashboardHeaders.indexOf('Roll No');
  if (dashboardRollIndex === -1) throw new Error('Attendance Dashboard must contain the Roll No header.');
  const priorPresentRolls = new Set();
  for (let rowIndex = 1; rowIndex < dashboardData.length; rowIndex++) {
    const rollNumber = normalizeRollNo(dashboardData[rowIndex][dashboardRollIndex]);
    if (rollNumber && priorColumns.some(column =>
      String(dashboardData[rowIndex][column] || '').trim().toUpperCase() === CONFIG.MARKERS.PRESENT
    )) priorPresentRolls.add(rollNumber);
  }
  return {
    dashboard,
    dashboardData,
    dashboardHeaders,
    attendanceColumn,
    priorPresentRolls,
    studentMetadata: getShuffleStudentMetadata_(spreadsheet)
  };
}

function getPriorShuffleSessionIds_(spreadsheet, latestSessionId) {
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.SESSIONS);
  if (!sheet) throw new Error('Sessions sheet is missing.');
  const data = sheet.getDataRange().getValues();
  const headers = data[0] || [];
  const idIndex = headers.indexOf('Session ID');
  const dateIndex = headers.indexOf('Session Date');
  if (idIndex === -1 || dateIndex === -1) throw new Error('Sessions sheet headers are invalid.');
  const sessionIds = [];
  for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
    const sessionId = String(data[rowIndex][idIndex] || '').trim();
    if (!sessionId || !toValidShuffleDate_(data[rowIndex][dateIndex])) {
      throw new Error('Attendance session history contains invalid metadata.');
    }
    sessionIds.push(sessionId);
  }
  if (new Set(sessionIds).size !== sessionIds.length) {
    throw new Error('Attendance session history contains duplicate session IDs.');
  }
  const latestIndex = sessionIds.indexOf(latestSessionId);
  if (latestIndex === -1) throw new Error('Latest attendance session was not found in session history.');
  return new Set(sessionIds.slice(0, latestIndex));
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
  if ([rollIndex, nameIndex, statusIndex, genderIndex].includes(-1)) {
    throw new Error('Students sheet must contain Roll Number, Full Name, Status, and Gender headers.');
  }
  const metadata = new Map();
  for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
    const rollNumber = normalizeRollNo(data[rowIndex][rollIndex]);
    if (!rollNumber) continue;
    const rawGender = String(data[rowIndex][genderIndex] || '');
    const gender = normalizeGender(rawGender);
    if (rawGender && gender !== rawGender) throw new Error('Students sheet contains an invalid Gender value.');
    if (metadata.has(rollNumber)) throw new Error('Students sheet contains duplicate normalized roll numbers.');
    metadata.set(rollNumber, {
      fullName: String(data[rowIndex][nameIndex] || '').trim(),
      status: String(data[rowIndex][statusIndex] || '').trim().toUpperCase(),
      gender
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
  const orderedStudents = students.slice().sort((first, second) =>
    first.rollNumber.localeCompare(second.rollNumber)
  );
  const attempts = Math.max(20, Math.min(50, students.length * 2));
  let bestGroups = null;
  let bestScore = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const capacities = buildGroupCapacities_(orderedStudents.length, groupCount, randomFn);
    const groups = capacities.map((capacity, index) => ({ number: index + 1, capacity, students: [] }));
    const newMembers = shuffleArray_(orderedStudents.filter(student => student.isNewMember === true), randomFn);
    const seedGroups = shuffleArray_(groups, randomFn)
      .sort((first, second) => second.capacity - first.capacity);
    newMembers.forEach((student, index) => {
      seedGroups[index].students.push(student);
    });

    const departmentCounts = new Map();
    orderedStudents.forEach(student => {
      departmentCounts.set(student.department, (departmentCounts.get(student.department) || 0) + 1);
    });
    const experienced = shuffleArray_(orderedStudents.filter(student => student.isNewMember !== true), randomFn)
      .sort((first, second) => {
        const genderPriority = Number(second.gender === 'Female') - Number(first.gender === 'Female');
        if (genderPriority !== 0) return genderPriority;
        return (departmentCounts.get(second.department) || 0) - (departmentCounts.get(first.department) || 0);
      });

    experienced.forEach(student => {
      const candidates = groups.filter(group => group.students.length < group.capacity);
      const scored = candidates.map(group => scoreStudentPlacement_(student, group, pairCounts, recentPairs, randomFn));
      scored.sort((first, second) => compareShuffleScores_(first.score, second.score));
      const bestScoreForStudent = scored[0].score;
      const bestCandidates = scored.filter(candidate => compareShuffleScores_(candidate.score, bestScoreForStudent) === 0);
      bestCandidates[Math.floor(randomFn() * bestCandidates.length)].group.students.push(student);
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
  const mentoringPriority = student.isNewMember !== true &&
    group.students.some(member => member.isNewMember === true) &&
    !group.students.some(member => member.isNewMember !== true) ? -1 : 0;
  const femaleCoveragePriority = student.gender === 'Female' &&
    !group.students.some(member => member.gender === 'Female') ? -1 : 0;
  return {
    group,
    score: [mentoringPriority, femaleCoveragePriority, sameDepartmentCount,
      recentRepeatCount, historicalPairCount, -remainingAfterPlacement],
    tieBreaker: randomFn()
  };
}

function scoreCandidateGroups_(groups, pairCounts, recentPairs) {
  let departmentPairs = 0;
  let recentRepeats = 0;
  let historicalRepeats = 0;
  let unsupportedNewTeams = 0;
  groups.forEach(group => {
    if (group.students.some(student => student.isNewMember === true) &&
        !group.students.some(student => student.isNewMember !== true)) unsupportedNewTeams += 1;
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
  const metrics = calculateShuffleMetrics_(groups, groups.flatMap(group => group.students));
  return [
    unsupportedNewTeams,
    metrics.femaleCoverageTarget - metrics.femaleCoveredTeams,
    metrics.multidisciplinaryTarget - metrics.multidisciplinaryTeams,
    departmentPairs,
    recentRepeats,
    historicalRepeats
  ];
}

function createShuffleSeed_(sessionId, weekKey, students, preferredSize, groupCount, pairHistory) {
  const studentFingerprint = students.map(student => [
    student.rollNumber,
    student.department,
    student.isNewMember === true ? 'N' : 'E',
    student.participationSource
  ].join(':')).sort().join('|');
  const pairFingerprint = pairHistory
    ? [...pairHistory.pairCounts.entries()].sort().map(entry => entry.join(':')).join('|')
    : '';
  const recentFingerprint = pairHistory ? [...pairHistory.recentPairs].sort().join('|') : '';
  const input = `${sessionId}|${weekKey}|${preferredSize}|${groupCount}|${studentFingerprint}|${pairFingerprint}|${recentFingerprint}|v2`;
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
  const genuineNewCount = students.filter(student => student.isNewMember === true).length;
  const experiencedCount = students.length - genuineNewCount;
  const femaleCount = students.filter(student => student.gender === 'Female').length;
  const femaleCoveredTeams = nonemptyGroups.filter(group =>
    group.students.some(student => student.gender === 'Female')
  ).length;
  const femaleCoverageTarget = Math.min(nonemptyGroups.length, femaleCount);
  const knownDepartmentCounts = {};
  students.forEach(student => {
    if (student.department && student.department !== 'UNK') {
      knownDepartmentCounts[student.department] = (knownDepartmentCounts[student.department] || 0) + 1;
    }
  });
  const knownDepartmentTotal = Object.values(knownDepartmentCounts).reduce((sum, count) => sum + count, 0);
  const largestDepartment = Math.max(0, ...Object.values(knownDepartmentCounts));
  const groupsWithTwoSeats = nonemptyGroups.filter(group => group.capacity >= 2).length;
  const multidisciplinaryTarget = Object.keys(knownDepartmentCounts).length < 2
    ? 0
    : Math.min(groupsWithTwoSeats, Math.floor(knownDepartmentTotal / 2), knownDepartmentTotal - largestDepartment);
  const multidisciplinaryTeams = nonemptyGroups.filter(group =>
    new Set(group.students.map(student => student.department).filter(department => department && department !== 'UNK')).size >= 2
  ).length;
  const newMemberTeams = nonemptyGroups.filter(group =>
    group.students.some(student => student.isNewMember === true)
  );
  const supportedNewTeams = newMemberTeams.filter(group =>
    group.students.some(student => student.isNewMember !== true)
  ).length;
  const warnings = [];
  if (femaleCoveredTeams < femaleCoverageTarget) warnings.push('Female coverage did not reach its feasible target.');
  if (multidisciplinaryTeams < multidisciplinaryTarget) warnings.push('Department coverage did not reach its unconstrained upper bound.');
  if (students.some(student => !student.gender)) warnings.push('Some participants have unknown Gender data.');
  if (students.some(student => !student.department || student.department === 'UNK')) warnings.push('Some departments could not be derived from roll numbers.');
  if (supportedNewTeams < newMemberTeams.length) warnings.push('Experienced members were insufficient to support every newcomer team.');
  return {
    minSize: sizes.length ? Math.min(...sizes) : 0,
    maxSize: sizes.length ? Math.max(...sizes) : 0,
    genuineNewCount,
    experiencedCount,
    teamsWithMultipleNew: nonemptyGroups.filter(group =>
      group.students.filter(student => student.isNewMember === true).length > 1
    ).length,
    newMemberTeams: newMemberTeams.length,
    supportedNewTeams,
    unsupportedNewTeams: newMemberTeams.length - supportedNewTeams,
    femaleCoveredTeams,
    femaleCoverageTarget,
    multidisciplinaryTeams,
    multidisciplinaryTarget,
    warnings
  };
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
  const metrics = info.metrics || calculateShuffleMetrics_(groups, groups.flatMap(group => group.students));
  const rows = [
    ['B-RIG Weekly Interdisciplinary Team Shuffle', '', '', '', '', ''],
    ['Attendance Session', info.sessionTitle || 'Attendance session', '', '', '', ''],
    ['Attendance Date', info.attendanceDate || '', '', '', '', ''],
    ['Generated', Utilities.formatDate(generatedAt, timeZone, 'yyyy-MM-dd HH:mm'), '', '', '', ''],
    ['Week', weekKey, '', '', '', ''],
    ['Students Present', Number.isFinite(info.presentCount) ? info.presentCount : totalStudents, '', '', '', ''],
    ['Final Participants', totalStudents, '', '', '', ''],
    ['Admin Added (Absent)', Number(info.adminAddedCount) || 0, '', '', '', ''],
    ['Genuine New Members', metrics.genuineNewCount, '', '', '', ''],
    ['Experienced Members', metrics.experiencedCount, '', '', '', ''],
    ['Preferred Group Strength', info.preferredGroupSize || '', '', '', '', ''],
    ['Groups Created', groups.length, '', '', '', ''],
    ['Random Seed (inputs must be unchanged)', info.seed || '', '', '', '', ''],
    ['Size Range', `${metrics.minSize}-${metrics.maxSize}`, '', '', '', ''],
    ['Teams With >1 Genuine New', metrics.teamsWithMultipleNew, '', '', '', ''],
    ['Supported New-Member Teams', `${metrics.supportedNewTeams}/${metrics.newMemberTeams}`, '', '', '', ''],
    ['Female-Covered Teams', `${metrics.femaleCoveredTeams}/${groups.length} (feasible target: ${metrics.femaleCoverageTarget})`, '', '', '', ''],
    ['Multidisciplinary Teams', `${metrics.multidisciplinaryTeams}/${groups.length} (unconstrained upper bound: ${metrics.multidisciplinaryTarget})`, '', '', '', '']
  ];
  if (info.groupCount > info.normalGroupCount) {
    rows.push(['Groups increased to keep new members in separate teams.', '', '', '', '', '']);
  }
  if (Number(info.newMemberCount) === totalStudents) {
    rows.push(['All participants are new members, so experienced-member mentoring could not be provided.', '', '', '', '', '']);
  }
  if (metrics.warnings.length) {
    rows.push(['Warnings', metrics.warnings.join(' '), '', '', '', '']);
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
    const groupNewCount = group.students.filter(student => student.isNewMember === true).length;
    const groupFemaleCovered = group.students.some(student => student.gender === 'Female') ? 'Yes' : 'No';
    const presentCount = group.students.filter(student => student.participationSource === 'Present').length;
    rows.push([
      `Size: ${group.students.length} | Female coverage: ${groupFemaleCovered} | New: ${groupNewCount} | Experienced: ${group.students.length - groupNewCount} | Present: ${presentCount} | Admin Added: ${group.students.length - presentCount}`,
      '', '', '', '', ''
    ]);
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
