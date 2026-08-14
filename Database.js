/**
 * Database interactions and sheet helpers.
 */

const DB = {
  
  /**
   * Safe wrapper for spreadsheet operations using LockService.
   * Prevents race conditions during concurrent check-ins.
   * @param {Function} callback Function to execute while lock is held.
   * @returns {*} Result of the callback.
   */
  withLock: function(callback) {
    const lock = LockService.getScriptLock();
    try {
      // Wait up to 10 seconds for other processes to finish.
      lock.waitLock(10000);
    } catch (e) {
      console.error('Lock Error: Could not obtain lock.', e);
      throw new Error('System is busy. Please try again in a moment.');
    }
    
    try {
      return callback();
    } catch (e) {
      console.error('Operation failed:', e);
      throw new Error('Error: ' + e.message);
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Retrieves all active students from the Students sheet.
   * @returns {Array} Array of student objects.
   */
  getActiveStudents: function() {
    const ss = getAttendanceSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
    if (!sheet) return [];

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const rollIndex = headers.indexOf('Roll Number');
    const nameIndex = headers.indexOf('Full Name');
    const statusIndex = headers.indexOf('Status');

    const students = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][statusIndex] === CONFIG.STATUS.STUDENT.ACTIVE) {
        students.push({
          rollNumber: normalizeRollNo(data[i][rollIndex]),
          fullName: data[i][nameIndex],
          row: i + 1
        });
      }
    }
    return students;
  },

  /**
   * Fetches a student by normalized roll number.
   * @param {string} rollNumber 
   * @returns {Object|null}
   */
  getStudentByRollNo: function(rollNumber) {
    const normalized = normalizeRollNo(rollNumber);
    const ss = getAttendanceSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
    if (!sheet) return null;

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const rollIndex = headers.indexOf('Roll Number');
    
    for (let i = 1; i < data.length; i++) {
      if (normalizeRollNo(data[i][rollIndex]) === normalized) {
        return {
          studentId: data[i][headers.indexOf('Student ID')],
          rollNumber: normalized,
          fullName: data[i][headers.indexOf('Full Name')],
          officialEmail: headers.indexOf('Official Email') === -1
            ? ''
            : data[i][headers.indexOf('Official Email')],
          gender: headers.indexOf(CONFIG.GENDER.HEADER) === -1
            ? ''
            : data[i][headers.indexOf(CONFIG.GENDER.HEADER)],
          status: data[i][headers.indexOf('Status')],
          row: i + 1
        };
      }
    }
    return null;
  },

  /**
   * Finds a session by its secure token.
   * @param {string} token 
   * @returns {Object|null}
   */
  getSessionByToken: function(token) {
    if (!token) return null;
    const ss = getAttendanceSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.SESSIONS);
    if (!sheet) return null;

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const tokenIndex = headers.indexOf('Token');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][tokenIndex] === token) {
        const sessionDate = new Date(data[i][headers.indexOf('Session Date')]);
        const opensAt = new Date(data[i][headers.indexOf('Opens At')]);
        const closesAt = new Date(data[i][headers.indexOf('Closes At')]);
        if (![sessionDate, opensAt, closesAt].every(value => Number.isFinite(value.getTime())) ||
            closesAt.getTime() <= opensAt.getTime()) {
          return null;
        }
        return {
          sessionId: data[i][headers.indexOf('Session ID')],
          date: sessionDate,
          title: data[i][headers.indexOf('Session Title')],
          opensAt: opensAt,
          closesAt: closesAt,
          status: data[i][headers.indexOf('Status')],
          token: token,
          row: i + 1
        };
      }
    }
    return null;
  },

  /**
   * Checks if a specific roll number has already checked in for a session.
   * @param {string} sessionId 
   * @param {string} rollNumber 
   * @returns {Object|null}
   */
  getCheckin: function(sessionId, rollNumber) {
    const normalized = normalizeRollNo(rollNumber);
    const ss = getAttendanceSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.CHECKINS);
    if (!sheet) return null;

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const sessionIndex = headers.indexOf('Session ID');
    const rollIndex = headers.indexOf('Roll Number');
    const timeIndex = headers.indexOf('Timestamp');
    const deviceIndex = headers.indexOf('Device ID');
    if (sessionIndex === -1 || rollIndex === -1 || timeIndex === -1) {
      throw new Error('Checkins sheet headers are invalid. Run workbook setup again.');
    }

    for (let i = 1; i < data.length; i++) {
      if (data[i][sessionIndex] === sessionId && normalizeRollNo(data[i][rollIndex]) === normalized) {
        return {
          timestamp: data[i][timeIndex],
          deviceHash: deviceIndex === -1 ? '' : data[i][deviceIndex]
        };
      }
    }
    return null;
  },

  /**
   * Validates the Students schema without mutating production data.
   * @returns {Array<string>} Current Students headers.
   */
  ensureStudentSchema: function() {
    const ss = getAttendanceSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
    if (!sheet) throw new Error('Students sheet is missing. Run workbook setup first.');

    const lastColumn = sheet.getLastColumn();
    const headerRange = lastColumn > 0 ? sheet.getRange(1, 1, 1, lastColumn) : null;
    const headers = headerRange ? headerRange.getValues()[0] : [];
    const coreHeaders = CONFIG.STUDENT_BASE_HEADERS.slice(0, 7);
    const coreIsValid = coreHeaders.every((header, index) => headers[index] === header);
    if (!coreIsValid) {
      throw new Error('Students sheet columns were renamed or reordered. Restore the headers before accepting attendance.');
    }

    const normalizedHeaders = headers.map(normalizeStudentHeader_);
    for (const requiredHeader of ['Official Email', CONFIG.GENDER.HEADER]) {
      const normalizedRequired = normalizeStudentHeader_(requiredHeader);
      const matches = normalizedHeaders
        .map((header, index) => header === normalizedRequired ? index : -1)
        .filter(index => index !== -1);
      if (matches.length !== 1 || headers[matches[0]] !== requiredHeader) {
        throw new Error(`Students sheet requires one canonical ${requiredHeader} column. Run the Gender schema migration.`);
      }
    }
    return headers;
  },

  inspectStudentGenderSchema: function(spreadsheet) {
    const ss = spreadsheet || getAttendanceSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
    if (!sheet) return { status: 'blocked', canApply: false, errors: ['Students sheet is missing.'] };

    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    const headerRange = lastColumn > 0 ? sheet.getRange(1, 1, 1, lastColumn) : null;
    const headers = headerRange ? headerRange.getValues()[0] : [];
    const headerFormulas = headerRange && typeof headerRange.getFormulas === 'function'
      ? headerRange.getFormulas()[0]
      : Array(lastColumn).fill('');
    const normalizedHeaders = headers.map(normalizeStudentHeader_);
    const errors = [];
    const duplicateHeaders = [];
    const headerCounts = new Map();
    normalizedHeaders.forEach(header => {
      if (!header) return;
      headerCounts.set(header, (headerCounts.get(header) || 0) + 1);
    });
    headerCounts.forEach((count, header) => {
      if (count > 1) duplicateHeaders.push(header);
    });
    if (duplicateHeaders.length) errors.push('Normalized duplicate headers exist.');
    if (normalizedHeaders.some(header => !header)) errors.push('Blank header cells exist in the used header range.');
    if (headerFormulas.some(formula => formula)) errors.push('Formula cells exist in the Students header row.');

    const baseIsValid = CONFIG.STUDENT_BASE_HEADERS.slice(0, 7)
      .every((header, index) => headers[index] === header);
    if (!baseIsValid) errors.push('Core Students headers were renamed or reordered.');
    const officialColumns = normalizedHeaders
      .map((header, index) => header === normalizeStudentHeader_('Official Email') ? index + 1 : 0)
      .filter(Boolean);
    if (officialColumns.length !== 1 || headers[officialColumns[0] - 1] !== 'Official Email') {
      errors.push('Exactly one canonical Official Email header is required.');
    }

    const genderColumns = normalizedHeaders
      .map((header, index) => header === normalizeStudentHeader_(CONFIG.GENDER.HEADER) ? index + 1 : 0)
      .filter(Boolean);
    if (genderColumns.length > 1) errors.push('Multiple Gender headers were found.');
    if (genderColumns.length === 1 && headers[genderColumns[0] - 1] !== CONFIG.GENDER.HEADER) {
      errors.push('The Gender header is not canonical.');
    }

    let rowsWithGender = 0;
    let rowsWithoutGender = 0;
    let unexpectedGenderValues = 0;
    let duplicateKeys = 0;
    if (lastRow > 1) {
      const data = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
      const rollIndex = headers.indexOf('Roll Number');
      const seenKeys = new Set();
      const genderIndex = genderColumns.length === 1 ? genderColumns[0] - 1 : -1;
      data.forEach(row => {
        const key = rollIndex === -1 ? '' : normalizeRollNo(row[rollIndex]);
        if (key && seenKeys.has(key)) duplicateKeys += 1;
        if (key) seenKeys.add(key);
        if (genderIndex === -1 || String(row[genderIndex] || '').trim() === '') {
          rowsWithoutGender += 1;
        } else if (normalizeGender(row[genderIndex]) === String(row[genderIndex])) {
          rowsWithGender += 1;
        } else {
          unexpectedGenderValues += 1;
        }
      });
    }

    if (duplicateKeys) errors.push('Duplicate normalized student keys were found.');
    if (unexpectedGenderValues) errors.push('Unexpected existing Gender values were found.');
    const status = errors.length
      ? 'blocked'
      : genderColumns.length === 1 ? 'already_applied' : 'ready';
    return {
      status,
      canApply: status === 'ready',
      spreadsheetId: ss.getId(),
      sheetId: sheet.getSheetId(),
      lastRow,
      lastColumn,
      proposedGenderColumn: status === 'ready' ? lastColumn + 1 : genderColumns[0] || null,
      rowsWithGender,
      rowsWithoutGender,
      unexpectedGenderValues,
      duplicateKeys,
      duplicateHeaderCount: duplicateHeaders.length,
      errors,
      headersDigest: stableSheetDigest_([headers], [[]]),
      legacyDigest: snapshotStudentRange_(sheet, lastColumn)
    };
  },

  /**
   * Ensures all duplicate-enforcement columns exist before accepting attendance.
   */
  ensureCheckinSchema: function() {
    const ss = getAttendanceSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.CHECKINS);
    if (!sheet) throw new Error('Checkins sheet is missing. Run workbook setup first.');

    const lastColumn = sheet.getLastColumn();
    const headers = lastColumn > 0
      ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
      : [];
    const coreHeaders = CONFIG.CHECKIN_HEADERS.slice(0, -1);
    const coreIsValid = coreHeaders.every((header, index) => headers[index] === header);
    if (!coreIsValid) {
      throw new Error('Checkins sheet columns were renamed or reordered. Restore the headers before accepting attendance.');
    }

    const deviceColumn = CONFIG.CHECKIN_HEADERS.length;
    if (headers[deviceColumn - 1] !== 'Device ID') {
      if (headers.includes('Device ID')) {
        throw new Error('Device ID must be the final standard column in the Checkins sheet.');
      }
      sheet.getRange(1, deviceColumn).setValue('Device ID').setFontWeight('bold');
    }
  },

  /**
   * Finds an attendance record created by the same browser device.
   * @param {string} sessionId
   * @param {string} deviceHash
   * @returns {Object|null}
   */
  getCheckinByDevice: function(sessionId, deviceHash) {
    const ss = getAttendanceSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.CHECKINS);
    if (!sheet || !deviceHash) return null;

    const data = sheet.getDataRange().getValues();
    const headers = data[0] || [];
    const sessionIndex = headers.indexOf('Session ID');
    const deviceIndex = headers.indexOf('Device ID');
    if (sessionIndex === -1 || deviceIndex === -1) {
      throw new Error('Checkins sheet headers are invalid. Run workbook setup again.');
    }

    for (let i = 1; i < data.length; i++) {
      if (data[i][sessionIndex] === sessionId && data[i][deviceIndex] === deviceHash) {
        return {
          timestamp: data[i][headers.indexOf('Timestamp')],
          rollNumber: data[i][headers.indexOf('Roll Number')]
        };
      }
    }
    return null;
  }
};

function normalizeStudentHeader_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function stableSheetDigest_(values, formulas) {
  const normalizeValue = value => Object.prototype.toString.call(value) === '[object Date]'
    ? { date: value.toISOString() }
    : value;
  const canonicalCells = values.map((row, rowIndex) => row.map((value, columnIndex) => {
    const formula = formulas[rowIndex]?.[columnIndex] || '';
    return formula ? { formula } : { value: normalizeValue(value) };
  }));
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(canonicalCells),
    Utilities.Charset.UTF_8
  );
  return digest.map(byte => (byte + 256).toString(16).slice(-2)).join('');
}

function snapshotStudentRange_(sheet, columnCount) {
  const rowCount = sheet.getLastRow();
  if (rowCount === 0 || columnCount === 0) return stableSheetDigest_([], []);
  const range = sheet.getRange(1, 1, rowCount, columnCount);
  const formulas = typeof range.getFormulas === 'function'
    ? range.getFormulas()
    : Array.from({ length: rowCount }, () => Array(columnCount).fill(''));
  return stableSheetDigest_(range.getValues(), formulas);
}
