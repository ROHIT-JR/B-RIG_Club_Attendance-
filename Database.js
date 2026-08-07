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
    const ss = SpreadsheetApp.getActiveSpreadsheet();
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
    const ss = SpreadsheetApp.getActiveSpreadsheet();
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
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.SESSIONS);
    if (!sheet) return null;

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const tokenIndex = headers.indexOf('Token');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][tokenIndex] === token) {
        return {
          sessionId: data[i][headers.indexOf('Session ID')],
          date: data[i][headers.indexOf('Session Date')],
          title: data[i][headers.indexOf('Session Title')],
          opensAt: new Date(data[i][headers.indexOf('Opens At')]),
          closesAt: new Date(data[i][headers.indexOf('Closes At')]),
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
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.CHECKINS);
    if (!sheet) return null;

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const sessionIndex = headers.indexOf('Session ID');
    const rollIndex = headers.indexOf('Roll Number');
    const timeIndex = headers.indexOf('Timestamp');
    if (sessionIndex === -1 || rollIndex === -1 || timeIndex === -1) {
      throw new Error('Checkins sheet headers are invalid. Run workbook setup again.');
    }

    for (let i = 1; i < data.length; i++) {
      if (data[i][sessionIndex] === sessionId && normalizeRollNo(data[i][rollIndex]) === normalized) {
        return {
          timestamp: data[i][timeIndex]
        };
      }
    }
    return null;
  },

  /**
   * Ensures all duplicate-enforcement columns exist before accepting attendance.
   */
  ensureCheckinSchema: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
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
    const ss = SpreadsheetApp.getActiveSpreadsheet();
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
