/**
 * @fileoverview Main server-side functions for the Club Attendance System.
 */

/**
 * Runs when the spreadsheet is opened. Adds a custom menu.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Club Attendance')
    .addItem('Show Current QR Code', 'showCurrentSessionQR')
    .addItem('Create New Attendance Session', 'createNewSession')
    .addItem('Close Current Session', 'closeCurrentSession')
    .addSeparator()
    .addItem('Reset / Clear All Sessions', 'clearAllData')
    .addSeparator()
    .addItem('Setup / Initialise Workbook', 'initialiseWorkbook')
    .addToUi();
}

/**
 * Initialises the workbook with required sheets and headers.
 */
function initWorkbook() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheetsConfig = [
    { name: CONFIG.SHEETS.DASHBOARD, headers: ['S.No', 'Name', 'Roll No'] },
    { name: CONFIG.SHEETS.STUDENTS, headers: ['Student ID', 'Roll Number', 'Full Name', 'Status', 'Registered At', 'Created By', 'Notes'] },
    { name: CONFIG.SHEETS.SESSIONS, headers: ['Session ID', 'Session Date', 'Session Title', 'Opens At', 'Closes At', 'Status', 'Token', 'Created At', 'Created By'] },
    { name: CONFIG.SHEETS.CHECKINS, headers: ['Checkin ID', 'Timestamp', 'Session ID', 'Session Date', 'Roll Number', 'Full Name', 'Result', 'Source', 'User Agent'] },
    { name: CONFIG.SHEETS.SETTINGS, headers: ['Setting', 'Value'] }
  ];

  sheetsConfig.forEach(config => {
    let sheet = ss.getSheetByName(config.name);
    if (!sheet) {
      sheet = ss.insertSheet(config.name);
    }
    
    // Set headers if the first row is empty
    const currentHeaders = sheet.getRange(1, 1, 1, config.headers.length).getValues()[0];
    if (currentHeaders.join('') === '') {
      sheet.getRange(1, 1, 1, config.headers.length).setValues([config.headers]).setFontWeight('bold');
    }
  });

  // Freeze rows and columns in Dashboard
  const dashboard = ss.getSheetByName(CONFIG.SHEETS.DASHBOARD);
  if (dashboard) {
    dashboard.setFrozenRows(1);
    dashboard.setFrozenColumns(3);
  }

  // Populate default settings if empty
  const settingsSheet = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
  if (settingsSheet && settingsSheet.getLastRow() <= 1) {
    const settingsData = [];
    for (const [key, value] of Object.entries(CONFIG.DEFAULT_SETTINGS)) {
      settingsData.push([key, value]);
    }
    settingsSheet.getRange(2, 1, settingsData.length, 2).setValues(settingsData);
  }

  SpreadsheetApp.getUi().alert('Workbook initialised successfully.');
}

/**
 * Prompts the user and creates a new attendance session.
 */
function createNewSession() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Basic prompt for session title
  const titleResponse = ui.prompt('New Session', 'Enter Session Title (e.g., General Meeting 1):', ui.ButtonSet.OK_CANCEL);
  if (titleResponse.getSelectedButton() !== ui.Button.OK) return;
  const title = titleResponse.getResponseText();

  // Basic prompt for duration
  const windowMins = parseInt(getSetting('Default attendance window in minutes')) || 60;
  const durationResponse = ui.prompt('Session Duration', `Enter duration in minutes (default ${windowMins}):`, ui.ButtonSet.OK_CANCEL);
  let duration = parseInt(durationResponse.getResponseText());
  if (isNaN(duration) || duration <= 0) duration = windowMins;

  const now = new Date();
  const opensAt = new Date(now);
  const closesAt = new Date(now.getTime() + duration * 60000);
  const sessionDate = new Date(now);
  sessionDate.setHours(0, 0, 0, 0); // Normalized to date only

  const sessionId = 'SES-' + now.getTime();
  const token = Utilities.getUuid();

  DB.withLock(() => {
    // 1. Add to Sessions sheet
    const sessionSheet = ss.getSheetByName(CONFIG.SHEETS.SESSIONS);
    sessionSheet.appendRow([
      sessionId, sessionDate, title, opensAt, closesAt, CONFIG.STATUS.SESSION.OPEN, token, now, 'Admin'
    ]);
    // Format session date
    sessionSheet.getRange(sessionSheet.getLastRow(), 2).setNumberFormat('dd/MM/yy');

    // 2. Add column to Dashboard
    const dashboard = ss.getSheetByName(CONFIG.SHEETS.DASHBOARD);
    const lastCol = dashboard.getLastColumn();
    const newCol = lastCol < 3 ? 4 : lastCol + 1; // Start from D (4)
    
    // Automatically insert a new column if we've run out of physical columns in the sheet
    if (newCol > dashboard.getMaxColumns()) {
      dashboard.insertColumnAfter(dashboard.getMaxColumns());
    }
    
    const sessionDateStr = Utilities.formatDate(sessionDate, getSetting('Time zone') || 'Asia/Kolkata', 'dd-MM-yyyy');
    const headerCell = dashboard.getRange(1, newCol);
    headerCell.setValue(sessionDateStr);
    headerCell.setNote(sessionId); // Embed invisible session ID constraint!
    dashboard.setColumnWidth(newCol, 110);

    // 3. Mark all students currently in dashboard as Absent ('A') for this new session
    const numRows = Math.max(0, dashboard.getLastRow() - 1);
    if (numRows > 0) {
      const absentValues = Array(numRows).fill([CONFIG.MARKERS.ABSENT]);
      dashboard.getRange(2, newCol, numRows, 1).setValues(absentValues);
    }

    // 4. Apply conditional formatting to the new column
    applyDashboardFormatting(dashboard, newCol);
  });

  // Show QR Code
  showCurrentSessionQR(token);
}

function applyDashboardFormatting(dashboard, colIndex) {
  const range = dashboard.getRange(2, colIndex, Math.max(1000, dashboard.getMaxRows()), 1);
  
  const presentRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(CONFIG.MARKERS.PRESENT)
    .setBackground('#d4edda') // Pale green
    .setFontColor('#155724') // Dark green
    .setBold(true)
    .setRanges([range])
    .build();

  const absentRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(CONFIG.MARKERS.ABSENT)
    .setBackground('#f8d7da') // Pale red
    .setFontColor('#721c24') // Dark red
    .setBold(true)
    .setRanges([range])
    .build();

  const preRegRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(CONFIG.MARKERS.PRE_REGISTRATION)
    .setFontColor('#6c757d') // Neutral gray
    .setRanges([range])
    .build();

  const rules = dashboard.getConditionalFormatRules();
  rules.push(presentRule, absentRule, preRegRule);
  dashboard.setConditionalFormatRules(rules);
}

/**
 * Finds the most recently opened session.
 */
function getOpenSession() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessionSheet = ss.getSheetByName(CONFIG.SHEETS.SESSIONS);
  if (!sessionSheet) return null;

  const data = sessionSheet.getDataRange().getValues();
  const headers = data[0];
  const statusIndex = headers.indexOf('Status');

  // Search backwards to find the latest open session
  for (let i = data.length - 1; i > 0; i--) {
    if (data[i][statusIndex] === CONFIG.STATUS.SESSION.OPEN) {
      return {
        sessionId: data[i][headers.indexOf('Session ID')],
        token: data[i][headers.indexOf('Token')],
        row: i + 1
      };
    }
  }
  return null;
}

/**
 * Shows the QR code for the current open session in a modal.
 */
function showCurrentSessionQR(providedToken) {
  let token = providedToken;
  if (!token) {
    const openSession = getOpenSession();
    if (!openSession) {
      SpreadsheetApp.getUi().alert('No open session found. Please create one first.');
      return;
    }
    token = openSession.token;
  }

  const webAppUrl = getSetting('Public Web App URL');
  if (!webAppUrl || webAppUrl === CONFIG.DEFAULT_SETTINGS['Public Web App URL']) {
    SpreadsheetApp.getUi().alert('Please set the Public Web App URL (Vercel URL) in the Settings sheet first.');
    return;
  }

  const scriptId = ScriptApp.getScriptId();
  // We append both session token and scriptId so Vercel can dynamically embed the right script
  const separator = webAppUrl.includes('?') ? '&' : '?';
  const fullUrl = `${webAppUrl}${separator}session=${token}&id=${scriptId}`;
  
  const htmlTemplate = HtmlService.createTemplateFromFile('AdminSidebar');
  htmlTemplate.url = fullUrl;
  
  const htmlOutput = htmlTemplate.evaluate()
    .setTitle('Attendance QR Code')
    .setWidth(500)
    .setHeight(600);

  SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'Scan to Check-in');
}

/**
 * Closes the currently open session.
 */
function closeCurrentSession() {
  const openSession = getOpenSession();
  if (!openSession) {
    SpreadsheetApp.getUi().alert('No open session found.');
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessionSheet = ss.getSheetByName(CONFIG.SHEETS.SESSIONS);
  const statusIndex = sessionSheet.getRange(1, 1, 1, sessionSheet.getLastColumn()).getValues()[0].indexOf('Status') + 1;
  
  sessionSheet.getRange(openSession.row, statusIndex).setValue(CONFIG.STATUS.SESSION.CLOSED);
  SpreadsheetApp.getUi().alert('Session closed successfully.');
}

// --------------------------------------------------------------------------------
// Web App endpoints (Frontend communication)
// --------------------------------------------------------------------------------

/**
 * Renders the Web App.
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  template.sessionToken = (e && e.parameter && e.parameter.session) ? e.parameter.session : '';
  return template.evaluate()
    .setTitle(getSetting('Club Name') || 'Club Attendance')
    .setFaviconUrl('https://avatars.githubusercontent.com/u/129193826?s=400&u=1fcd80a193fc7377208d6fb5a02686bcc8754f66&v=4')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Helper to include HTML/CSS inside other HTML files.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Called by frontend to get session details by token.
 */
function getClientSessionDetails(token) {
  if (!token) return { valid: false, reason: 'No session provided.' };
  
  const session = DB.getSessionByToken(token);
  if (!session) return { valid: false, reason: 'Invalid session.' };
  
  if (session.status !== CONFIG.STATUS.SESSION.OPEN) {
    return { valid: false, reason: 'Session is closed.' };
  }

  const now = new Date();
  if (now < session.opensAt) return { valid: false, reason: 'Session has not opened yet.' };
  if (now > session.closesAt) return { valid: false, reason: 'Session has expired.' };

  const sessionDateStr = Utilities.formatDate(session.date, getSetting('Time zone') || 'Asia/Kolkata', 'dd-MM-yyyy');
  return { valid: true, title: session.title, date: sessionDateStr, clubName: getSetting('Club Name') };
}

/**
 * Called by frontend to check if a roll number exists.
 */
function validateRollNo(rollNumber) {
  const student = DB.getStudentByRollNo(rollNumber);
  const activeStatus = CONFIG.STATUS.STUDENT.ACTIVE.toUpperCase();
  if (student && (!student.status || String(student.status).trim().toUpperCase() === activeStatus)) {
    return { exists: true, fullName: student.fullName, rollNumber: student.rollNumber };
  }
  return { exists: false };
}

/**
 * Securely records attendance.
 */
function submitAttendance(sessionToken, rollNumber, fullName, isNewRegistration) {
  if (!sessionToken || !rollNumber) {
    return { success: false, error: 'Missing required information.' };
  }

  return DB.withLock(() => {
    // 1. Re-validate session
    const session = DB.getSessionByToken(sessionToken);
    if (!session || session.status !== CONFIG.STATUS.SESSION.OPEN) {
      return { success: false, error: 'Session is invalid or closed.' };
    }
    const now = new Date();
    if (now > session.closesAt) {
      return { success: false, error: 'Session has expired.' };
    }

    const normalizedRollNo = normalizeRollNo(rollNumber);

    // 2. Check for duplicate
    const existingCheckin = DB.getCheckin(session.sessionId, normalizedRollNo);
    if (existingCheckin) {
      return { success: false, duplicate: true, time: existingCheckin.timestamp };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const studentsSheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
    const dashboard = ss.getSheetByName(CONFIG.SHEETS.DASHBOARD);
    const checkinsSheet = ss.getSheetByName(CONFIG.SHEETS.CHECKINS);

    // 3. Handle Registration / Student Lookup
    let student = DB.getStudentByRollNo(normalizedRollNo);
    let studentRowInDashboard = -1;

    if (!student) {
      if (!isNewRegistration) return { success: false, error: 'Student not found.' };
      if (!fullName) return { success: false, error: 'Full name required for registration.' };

      // Register new student
      const studentId = 'STU-' + now.getTime();
      const rawApprovalSetting = getSetting('New registrations require approval');
      const status = (String(rawApprovalSetting).toUpperCase() === 'TRUE') 
        ? CONFIG.STATUS.STUDENT.PENDING 
        : CONFIG.STATUS.STUDENT.ACTIVE;

      studentsSheet.appendRow([
        studentId, normalizedRollNo, fullName, status, now, 'System', ''
      ]);

      // Add to dashboard
      const nextSNo = Math.max(1, dashboard.getLastRow()); // basic s.no
      dashboard.appendRow([nextSNo, fullName, normalizedRollNo]);
      studentRowInDashboard = dashboard.getLastRow();

      // Backfill past sessions with '—'
      const headers = dashboard.getRange(1, 1, 1, dashboard.getLastColumn()).getValues()[0];
      for (let col = 4; col <= headers.length; col++) {
        dashboard.getRange(studentRowInDashboard, col).setValue(CONFIG.MARKERS.PRE_REGISTRATION);
      }

    } else {
      const activeStatus = CONFIG.STATUS.STUDENT.ACTIVE.toUpperCase();
      if (student.status && String(student.status).trim().toUpperCase() !== activeStatus) {
        return { success: false, error: 'Student status is not active.' };
      }
      fullName = student.fullName || fullName; // use trusted name if exists
      // Find row in dashboard
      const dashData = dashboard.getDataRange().getValues();
      for (let i = 1; i < dashData.length; i++) {
        if (normalizeRollNo(dashData[i][2]) === normalizedRollNo) { // Column C is Roll No
          studentRowInDashboard = i + 1;
          break;
        }
      }
      if (studentRowInDashboard === -1) {
        // Somehow missing from dashboard, add them
        const nextSNo = Math.max(1, dashboard.getLastRow());
        dashboard.appendRow([nextSNo, fullName, normalizedRollNo]);
        studentRowInDashboard = dashboard.getLastRow();
      }
    }

    // 4. Mark Present in Dashboard
    // Securely find the session column using embedded Note or backwards date match
    const numCols = dashboard.getLastColumn() - 3;
    let sessionCol = -1;
    
    if (numCols > 0) {
      const headerRange = dashboard.getRange(1, 4, 1, numCols);
      const notes = headerRange.getNotes()[0];
      const values = headerRange.getValues()[0];
      const sessionDateStr = Utilities.formatDate(session.date, getSetting('Time zone') || 'Asia/Kolkata', 'dd-MM-yyyy');
      
      // We search BACKWARDS to prefer the newest column
      for (let i = numCols - 1; i >= 0; i--) {
        if (notes[i] === session.sessionId) {
          sessionCol = i + 4;
          break; // Found exact match via note!
        }
        
        // Fallback to date match if note is missing (older sessions)
        if (sessionCol === -1) {
          let headerVal = values[i];
          let headerStr = "";
          if (headerVal instanceof Date) {
            headerStr = Utilities.formatDate(headerVal, getSetting('Time zone') || 'Asia/Kolkata', 'dd-MM-yyyy');
          } else {
            headerStr = String(headerVal).trim();
          }
          if (headerStr === sessionDateStr) {
            sessionCol = i + 4;
          }
        }
      }
    }
    
    if (sessionCol !== -1) {
      dashboard.getRange(studentRowInDashboard, sessionCol).setValue(CONFIG.MARKERS.PRESENT);
    }

    // 5. Log Checkin
    const checkinId = 'CHK-' + now.getTime();
    checkinsSheet.appendRow([
      checkinId, now, session.sessionId, session.date, normalizedRollNo, fullName, 'Present', 'QR Web App', ''
    ]);

    return { success: true };
  });
}

/**
 * Resets all attendance data (Sessions, Checkins, and Dashboard columns)
 * but keeps the registered students and settings.
 */
function clearAllData() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('WARNING: Factory Reset', 
    'Are you sure you want to delete ALL past sessions and check-in records? (Your registered students will NOT be deleted). This cannot be undone.', 
    ui.ButtonSet.YES_NO);
    
  if (response == ui.Button.YES) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Clear Sessions
    const sessions = ss.getSheetByName(CONFIG.SHEETS.SESSIONS);
    if (sessions && sessions.getLastRow() > 1) {
      sessions.getRange(2, 1, sessions.getLastRow() - 1, sessions.getLastColumn()).clearContent();
    }
    
    // Clear Checkins
    const checkins = ss.getSheetByName(CONFIG.SHEETS.CHECKINS);
    if (checkins && checkins.getLastRow() > 1) {
      checkins.getRange(2, 1, checkins.getLastRow() - 1, checkins.getLastColumn()).clearContent();
    }
    
    // Clear Dashboard Columns past C (3)
    const dashboard = ss.getSheetByName(CONFIG.SHEETS.DASHBOARD);
    if (dashboard && dashboard.getLastColumn() > 3) {
      // Delete the session columns completely so it shrinks back to just the student names
      dashboard.deleteColumns(4, dashboard.getLastColumn() - 3);
    }
    
    ui.alert('Data reset successfully! Your student list is preserved, but all test sessions have been erased.');
  }
}
