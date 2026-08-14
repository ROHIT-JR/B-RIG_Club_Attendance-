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
    .addItem('Shuffle', 'shuffleStudentsIntoGroups')
    .addSeparator()
    .addItem('Reset / Clear All Sessions', 'clearAllData')
    .addSeparator()
    .addItem('Setup / Initialise Workbook', 'initWorkbook')
    .addItem('Check Gender Schema (Dry Run)', 'dryRunGenderSchemaUpgrade')
    .addItem('Apply Gender Schema Upgrade', 'applyGenderSchemaUpgrade')
    .addToUi();
}

/**
 * Initialises the workbook with required sheets and headers.
 */
function initWorkbook() {
  const ss = getAttendanceSpreadsheet();

  const sheetsConfig = [
    { name: CONFIG.SHEETS.DASHBOARD, headers: ['S.No', 'Name', 'Roll No'] },
    { name: CONFIG.SHEETS.STUDENTS, headers: CONFIG.STUDENT_HEADERS, protectedUpgrade: CONFIG.GENDER.HEADER },
    { name: CONFIG.SHEETS.SESSIONS, headers: ['Session ID', 'Session Date', 'Session Title', 'Opens At', 'Closes At', 'Status', 'Token', 'Created At', 'Created By'] },
    { name: CONFIG.SHEETS.CHECKINS, headers: CONFIG.CHECKIN_HEADERS },
    { name: CONFIG.SHEETS.SETTINGS, headers: ['Setting', 'Value'] }
  ];

  sheetsConfig.forEach(config => {
    let sheet = ss.getSheetByName(config.name);
    if (!sheet) {
      sheet = ss.insertSheet(config.name);
    }
    
    // Create headers for new sheets and append columns introduced by upgrades.
    const lastColumn = sheet.getLastColumn();
    const currentHeaders = lastColumn > 0
      ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
      : [];
    if (currentHeaders.every(header => header === '')) {
      sheet.getRange(1, 1, 1, config.headers.length).setValues([config.headers]).setFontWeight('bold');
    } else {
      const missingHeaders = config.headers.filter(header =>
        !currentHeaders.includes(header) && header !== config.protectedUpgrade
      );
      if (missingHeaders.length > 0) {
        sheet.getRange(1, currentHeaders.length + 1, 1, missingHeaders.length)
          .setValues([missingHeaders])
          .setFontWeight('bold');
      }
    }
  });

  // Freeze rows and columns in Dashboard
  const dashboard = ss.getSheetByName(CONFIG.SHEETS.DASHBOARD);
  if (dashboard) {
    dashboard.setFrozenRows(1);
    dashboard.setFrozenColumns(3);
  }

  // Add missing default settings without replacing existing values.
  const settingsSheet = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
  if (settingsSheet) {
    const existingKeys = settingsSheet.getLastRow() > 1
      ? settingsSheet.getRange(2, 1, settingsSheet.getLastRow() - 1, 1).getValues().flat()
      : [];
    const missingSettings = Object.entries(CONFIG.DEFAULT_SETTINGS)
      .filter(([key]) => !existingKeys.includes(key));
    if (missingSettings.length > 0) {
      settingsSheet.getRange(settingsSheet.getLastRow() + 1, 1, missingSettings.length, 2)
        .setValues(missingSettings);
    }
  }

  sanitizeExistingCheckinUserAgents_();

  SpreadsheetApp.getUi().alert('Workbook initialised successfully.');
}

function dryRunGenderSchemaUpgrade() {
  const report = DB.inspectStudentGenderSchema();
  SpreadsheetApp.getUi().alert(formatGenderMigrationReport_(report, 'DRY RUN - no writes performed'));
  return report;
}

function applyGenderSchemaUpgrade() {
  const ui = SpreadsheetApp.getUi();
  const preview = DB.inspectStudentGenderSchema();
  if (preview.status === 'already_applied') {
    ui.alert(formatGenderMigrationReport_(preview, 'Gender schema already applied - no changes made'));
    return preview;
  }
  if (!preview.canApply) {
    ui.alert(formatGenderMigrationReport_(preview, 'Gender schema migration blocked'));
    return preview;
  }
  const confirmation = ui.alert(
    'Apply Gender Schema Upgrade',
    'A timestamped spreadsheet copy will be verified before one Gender header cell is appended. Continue?',
    ui.ButtonSet.YES_NO
  );
  if (confirmation !== ui.Button.YES) return { status: 'cancelled' };
  const result = applyGenderSchemaMigration_();
  ui.alert(formatGenderMigrationReport_(result, result.verified ? 'Migration verified' : 'Migration failed'));
  return result;
}

function applyGenderSchemaMigration_() {
  return DB.withLock(() => {
    const ss = getAttendanceSpreadsheet();
    const before = DB.inspectStudentGenderSchema(ss);
    if (before.status === 'already_applied') return { ...before, verified: true, noOp: true };
    if (!before.canApply) return { ...before, verified: false };

    const timestamp = Utilities.formatDate(new Date(), getSetting('Time zone') || 'Asia/Kolkata', 'yyyyMMdd-HHmmss');
    const backup = ss.copy(`${ss.getName()} - Before Gender Migration ${timestamp}`);
    const backupReport = DB.inspectStudentGenderSchema(backup);
    if (backupReport.legacyDigest !== before.legacyDigest ||
        backupReport.lastRow !== before.lastRow || backupReport.lastColumn !== before.lastColumn) {
      throw new Error('Backup verification failed. The original spreadsheet was not changed.');
    }

    const revalidated = DB.inspectStudentGenderSchema(ss);
    if (!revalidated.canApply || revalidated.legacyDigest !== before.legacyDigest ||
        revalidated.sheetId !== before.sheetId) {
      throw new Error('Students schema changed during backup. The original spreadsheet was not changed.');
    }
    const sheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
    const newColumn = before.lastColumn + 1;
    if (newColumn > sheet.getMaxColumns()) sheet.insertColumnAfter(sheet.getMaxColumns());
    sheet.getRange(1, newColumn).setValue(CONFIG.GENDER.HEADER).setFontWeight('bold');
    SpreadsheetApp.flush();

    const after = DB.inspectStudentGenderSchema(ss);
    const preservedDigest = snapshotStudentRange_(sheet, before.lastColumn);
    const verified = after.status === 'already_applied' &&
      after.lastRow === before.lastRow && after.lastColumn === before.lastColumn + 1 &&
      preservedDigest === before.legacyDigest;
    return {
      ...after,
      verified,
      backupId: backup.getId(),
      backupUrl: backup.getUrl(),
      beforeRows: before.lastRow,
      beforeColumns: before.lastColumn,
      preservedDigest
    };
  });
}

function formatGenderMigrationReport_(report, title) {
  const lines = [
    title,
    `Status: ${report.status || 'unknown'}`,
    `Rows: ${report.lastRow === undefined ? 'n/a' : report.lastRow}`,
    `Columns: ${report.lastColumn === undefined ? 'n/a' : report.lastColumn}`,
    `Proposed Gender column: ${report.proposedGenderColumn || 'n/a'}`,
    `Rows with Gender: ${report.rowsWithGender || 0}`,
    `Rows without Gender: ${report.rowsWithoutGender || 0}`,
    `Unexpected Gender values: ${report.unexpectedGenderValues || 0}`,
    `Duplicate keys: ${report.duplicateKeys || 0}`,
    `Preservation digest: ${report.preservedDigest || report.legacyDigest || 'n/a'}`
  ];
  if (report.backupId) lines.push(`Verified backup ID: ${report.backupId}`);
  if (report.backupUrl) lines.push(`Verified backup URL: ${report.backupUrl}`);
  if (report.errors && report.errors.length) lines.push(`Blocked by: ${report.errors.join(' ')}`);
  return lines.join('\n');
}

/**
 * Prompts the user and creates a new attendance session.
 */
function createNewSession() {
  const ui = SpreadsheetApp.getUi();
  const ss = getAttendanceSpreadsheet();
  
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
  const ss = getAttendanceSpreadsheet();
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

  const studentAppUrl = getStudentAppUrl();
  if (!studentAppUrl) {
    const legacyUrl = getSetting('Public Web App URL');
    const migrationMessage = isAppsScriptWebAppUrl(legacyUrl)
      ? 'Public Student URL is still configured as an Apps Script URL. Set Student Web App URL to the deployed Vercel attendance URL.'
      : 'Set Student Web App URL in the Settings sheet to the deployed HTTPS Vercel attendance URL.';
    SpreadsheetApp.getUi().alert(
      migrationMessage
    );
    return;
  }

  const htmlTemplate = HtmlService.createTemplateFromFile('AdminSidebar');
  const adminGrant = Utilities.getUuid();
  CacheService.getScriptCache().put(`admin-qr:${adminGrant}`, String(token), 21600);
  htmlTemplate.sessionToken = token;
  htmlTemplate.adminGrant = adminGrant;
  
  const htmlOutput = htmlTemplate.evaluate()
    .setTitle('Attendance QR Code')
    .setWidth(500)
    .setHeight(600);

  SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'Scan to Check-in');
}

/**
 * Returns a short-lived signed URL for the live admin QR display.
 * @param {string} token
 * @param {string} adminGrant
 * @returns {Object}
 */
function getRotatingQrData(token, adminGrant) {
  const grantedToken = adminGrant
    ? CacheService.getScriptCache().get(`admin-qr:${adminGrant}`)
    : null;
  if (!grantedToken || !safeStringEqual_(String(grantedToken), String(token))) {
    return { valid: false, error: 'This admin QR display is not authorized.' };
  }
  CacheService.getScriptCache().put(`admin-qr:${adminGrant}`, String(token), 21600);

  const session = DB.getSessionByToken(token);
  const now = new Date();
  if (!session || session.status !== CONFIG.STATUS.SESSION.OPEN || now < session.opensAt || now > session.closesAt) {
    return { valid: false, error: 'This attendance session is no longer open.' };
  }

  const studentAppUrl = getStudentAppUrl();
  if (!studentAppUrl) {
    return { valid: false, error: 'The Student Web App URL is not configured. Set it to the deployed Vercel frontend.' };
  }

  const expiresAt = Date.now() + (CONFIG.ACCESS_CONTROL.QR_LIFETIME_SECONDS * 1000);
  const signature = signQrAccess_(token, expiresAt);
  const url = `${studentAppUrl}?session=${encodeURIComponent(token)}` +
    `&access=${encodeURIComponent(signature)}&expires=${expiresAt}`;

  return {
    valid: true,
    url: url,
    expiresAt: expiresAt,
    refreshAfterSeconds: CONFIG.ACCESS_CONTROL.QR_REFRESH_SECONDS
  };
}

/**
 * Gets or creates the server-only secret used to sign QR access links.
 * @returns {string}
 */
function getQrSigningSecret_() {
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty('QR_SIGNING_SECRET');
  if (secret) return secret;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    secret = properties.getProperty('QR_SIGNING_SECRET');
    if (!secret) {
      secret = Utilities.getUuid() + Utilities.getUuid();
      properties.setProperty('QR_SIGNING_SECRET', secret);
    }
  } finally {
    lock.releaseLock();
  }
  return secret;
}

/**
 * Signs a session token and expiration timestamp.
 * @param {string} token
 * @param {number} expiresAt
 * @returns {string}
 */
function signQrAccess_(token, expiresAt) {
  const bytes = Utilities.computeHmacSha256Signature(
    `${token}:${expiresAt}`,
    getQrSigningSecret_(),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

/**
 * Validates a signed QR link without trusting client time.
 * @param {string} token
 * @param {string} signature
 * @param {number|string} expiresAt
 * @returns {boolean}
 */
function isValidQrAccess_(token, signature, expiresAt) {
  const expiration = Number(expiresAt);
  const maxFuture = (CONFIG.ACCESS_CONTROL.QR_LIFETIME_SECONDS + 5) * 1000;
  if (!token || !signature || !Number.isFinite(expiration)) return false;
  if (expiration < Date.now() || expiration - Date.now() > maxFuture) return false;
  return safeStringEqual_(String(signature), signQrAccess_(token, expiration));
}

/**
 * Compares two strings without exiting on the first different character.
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function safeStringEqual_(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) {
    difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * Issues a temporary grant bound to one session and browser device.
 * @param {string} sessionToken
 * @param {string} deviceId
 * @returns {string}
 */
function issueAccessGrant_(sessionToken, deviceId) {
  const grant = Utilities.getUuid();
  CacheService.getScriptCache().put(
    `access-grant:${grant}`,
    JSON.stringify({ sessionToken: sessionToken, deviceHash: hashDeviceId(deviceId) }),
    CONFIG.ACCESS_CONTROL.GRANT_LIFETIME_SECONDS
  );
  return grant;
}

/**
 * Checks that a temporary grant belongs to the current session and browser.
 * @param {string} grant
 * @param {string} sessionToken
 * @param {string} deviceId
 * @returns {boolean}
 */
function isValidAccessGrant_(grant, sessionToken, deviceId) {
  if (!grant || !sessionToken || !deviceId || !CONFIG.DEVICE_ID_PATTERN.test(String(deviceId))) return false;
  const cached = CacheService.getScriptCache().get(`access-grant:${grant}`);
  if (!cached) return false;
  try {
    const data = JSON.parse(cached);
    return safeStringEqual_(String(data.sessionToken), String(sessionToken)) &&
      safeStringEqual_(String(data.deviceHash), hashDeviceId(String(deviceId)));
  } catch (error) {
    return false;
  }
}

/**
 * Closes the currently open session.
 */
function closeCurrentSession() {
  const closed = DB.withLock(() => {
    const openSession = getOpenSession();
    if (!openSession) return false;

    const ss = getAttendanceSpreadsheet();
    const sessionSheet = ss.getSheetByName(CONFIG.SHEETS.SESSIONS);
    const headers = sessionSheet.getRange(1, 1, 1, sessionSheet.getLastColumn()).getValues()[0];
    const statusIndex = headers.indexOf('Status') + 1;
    if (statusIndex < 1) throw new Error('Sessions sheet headers are invalid. Run workbook setup again.');

    sessionSheet.getRange(openSession.row, statusIndex).setValue(CONFIG.STATUS.SESSION.CLOSED);
    return true;
  });
  SpreadsheetApp.getUi().alert(closed ? 'Session closed successfully.' : 'No open session found.');
}

// --------------------------------------------------------------------------------
// Web App endpoints (Frontend communication)
// --------------------------------------------------------------------------------

/**
 * Returns a minimal status response. Student attendance is hosted on Vercel.
 */
function doGet() {
  return jsonResponse_({
    ok: true,
    service: 'B-RIG Attendance API',
    studentFrontend: 'external'
  });
}

/**
 * Handles authenticated Vercel-to-Apps-Script JSON requests.
 * @param {Object} e
 * @returns {TextOutput}
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !String(e.postData.type || '').toLowerCase().startsWith('application/json')) {
      return jsonResponse_({ success: false, error: 'Request could not be processed.' });
    }

    const contents = String(e.postData.contents || '');
    if (!contents || contents.length > 16384) {
      return jsonResponse_({ success: false, error: 'Request could not be processed.' });
    }

    let request;
    try {
      request = JSON.parse(contents);
    } catch (error) {
      return jsonResponse_({ success: false, error: 'Request could not be processed.' });
    }
    if (!request || typeof request !== 'object' || Array.isArray(request) || !verifyVercelApiSecret_(request.apiSecret)) {
      return jsonResponse_({ success: false, error: 'Request could not be processed.' });
    }

    switch (request.action) {
      case 'sessionDetails':
        return jsonResponse_(getClientSessionDetails(
          requireApiString_(request.sessionToken, 128),
          requireApiString_(request.accessCode, 256),
          requireApiString_(request.accessExpires, 32),
          requireApiString_(request.deviceId, 64)
        ));

      case 'validateRoll':
        return jsonResponse_(validateRollNo(
          requireApiString_(request.rollNumber, 32),
          requireApiString_(request.sessionToken, 128),
          requireApiString_(request.deviceId, 64),
          requireApiString_(request.accessGrant, 128)
        ));

      case 'submitAttendance':
        if (typeof request.isNewRegistration !== 'boolean') throw new Error('Invalid request field.');
        return jsonResponse_(submitAttendance(
          requireApiString_(request.sessionToken, 128),
          requireApiString_(request.rollNumber, 32),
          optionalApiString_(request.fullName, 80),
          optionalApiString_(request.officialEmail, 120),
          optionalApiString_(request.gender, 16),
          request.isNewRegistration,
          requireApiString_(request.deviceId, 64),
          optionalApiString_(request.userAgent, 250),
          requireApiString_(request.accessGrant, 128)
        ));

      default:
        return jsonResponse_({ success: false, error: 'Unsupported action.' });
    }
  } catch (error) {
    console.error('Attendance API request failed:', error);
    if (error && error.name === 'AttendanceConfigurationError') {
      return jsonResponse_({
        success: false,
        error: 'Attendance is not configured correctly. Contact the club administrator.',
        retryable: false,
        configurationError: true
      });
    }
    return jsonResponse_({
      success: false,
      error: 'The attendance service is temporarily unavailable. Please try again.',
      retryable: true
    });
  }
}

/**
 * Verifies the server-to-server secret stored in Script Properties.
 * @param {*} providedSecret
 * @returns {boolean}
 */
function verifyVercelApiSecret_(providedSecret) {
  const configuredSecret = PropertiesService.getScriptProperties().getProperty('VERCEL_API_SECRET');
  if (!configuredSecret || configuredSecret.length < 32 || typeof providedSecret !== 'string') return false;
  return safeStringEqual_(configuredSecret, providedSecret);
}

/**
 * Validates a required API string field.
 * @param {*} value
 * @param {number} maxLength
 * @returns {string}
 */
function requireApiString_(value, maxLength) {
  if (typeof value !== 'string' || !value || value.length > maxLength) {
    throw new Error('Invalid request field.');
  }
  return value;
}

/**
 * Validates an optional API string field.
 * @param {*} value
 * @param {number} maxLength
 * @returns {string}
 */
function optionalApiString_(value, maxLength) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error('Invalid request field.');
  }
  return value;
}

/**
 * Creates a JSON Apps Script response.
 * @param {Object} payload
 * @returns {TextOutput}
 */
function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Called by frontend to get session details by token.
 */
function getClientSessionDetails(token, accessCode, accessExpires, deviceId) {
  if (!token) return { valid: false, reason: 'No session provided.' };
  if (!deviceId || !CONFIG.DEVICE_ID_PATTERN.test(String(deviceId))) {
    return { valid: false, reason: 'Browser storage is required for secure attendance.' };
  }
  if (!isValidQrAccess_(token, accessCode, accessExpires)) {
    return { valid: false, reason: 'This QR link has expired. Scan the live QR code again.' };
  }
  
  const session = DB.getSessionByToken(token);
  if (!session) return { valid: false, reason: 'Invalid session.' };
  
  if (session.status !== CONFIG.STATUS.SESSION.OPEN) {
    return { valid: false, reason: 'Session is closed.' };
  }

  const now = new Date();
  if (now < session.opensAt) return { valid: false, reason: 'Session has not opened yet.' };
  if (now > session.closesAt) return { valid: false, reason: 'Session has expired.' };

  const sessionDateStr = Utilities.formatDate(session.date, getSetting('Time zone') || 'Asia/Kolkata', 'dd-MM-yyyy');
  return {
    valid: true,
    title: session.title,
    date: sessionDateStr,
    clubName: getSetting('Club Name'),
    accessGrant: issueAccessGrant_(token, String(deviceId))
  };
}

/**
 * Called by frontend to check if a roll number exists.
 */
function validateRollNo(rollNumber, sessionToken, deviceId, accessGrant) {
  if (!isValidAccessGrant_(accessGrant, sessionToken, deviceId)) {
    return { valid: false, error: 'Secure access expired. Scan the live QR code again.' };
  }
  const session = DB.getSessionByToken(sessionToken);
  const now = new Date();
  if (!session || session.status !== CONFIG.STATUS.SESSION.OPEN || now < session.opensAt || now > session.closesAt) {
    return { valid: false, error: 'This attendance session is no longer open.' };
  }
  const normalizedRollNo = normalizeRollNo(rollNumber);
  if (!isValidRollNo(normalizedRollNo)) {
    return {
      valid: false,
      error: 'Enter a valid CB university roll number using letters, numbers, and periods only.'
    };
  }

  const student = DB.getStudentByRollNo(normalizedRollNo);
  const activeStatus = CONFIG.STATUS.STUDENT.ACTIVE.toUpperCase();
  if (student && (!student.status || String(student.status).trim().toUpperCase() === activeStatus)) {
    const storedGender = String(student.gender || '');
    if (storedGender && normalizeGender(storedGender) !== storedGender) {
      return attendanceError_('INVALID_GENDER', 'Your profile needs administrator review before attendance can be recorded.');
    }
    return {
      valid: true,
      exists: true,
      fullName: student.fullName,
      rollNumber: student.rollNumber,
      genderRequired: !storedGender
    };
  }
  if (student) {
    return { valid: false, error: 'Your registration is awaiting administrator approval.' };
  }
  return { valid: true, exists: false, rollNumber: normalizedRollNo };
}

/**
 * Securely records attendance.
 */
function submitAttendance(sessionToken, rollNumber, fullName, officialEmail, gender, isNewRegistration, deviceId, userAgent, accessGrant) {
  if (!sessionToken || !rollNumber) {
    return { success: false, error: 'Missing required information.' };
  }
  if (!isValidAccessGrant_(accessGrant, sessionToken, deviceId)) {
    return { success: false, error: 'Secure access expired. Scan the live QR code again.' };
  }

  const normalizedRollNo = normalizeRollNo(rollNumber);
  if (!isValidRollNo(normalizedRollNo)) {
    return { success: false, error: 'Enter a valid CB university roll number using letters, numbers, and periods only.' };
  }
  if (!deviceId || !CONFIG.DEVICE_ID_PATTERN.test(String(deviceId))) {
    return { success: false, error: 'This browser could not be verified. Enable browser storage and try again.' };
  }

  fullName = normalizeFullName(fullName);
  if (isNewRegistration && !isValidFullName(fullName)) {
    return { success: false, error: 'Enter a valid full name between 2 and 80 characters.' };
  }
  officialEmail = normalizeOfficialEmail(officialEmail);
  if (isNewRegistration && !isValidOfficialEmail(officialEmail, normalizedRollNo)) {
    return {
      success: false,
      error: `Use your official college email: ${getOfficialEmailForRollNo(normalizedRollNo)}.`
    };
  }
  const submittedGender = normalizeGender(gender);
  if (String(gender || '').trim() && !submittedGender) {
    return attendanceError_('INVALID_GENDER', 'Select Male or Female.');
  }
  if (isNewRegistration && !submittedGender) {
    return attendanceError_('GENDER_REQUIRED', 'Select Male or Female to continue.');
  }

  const deviceHash = hashDeviceId(String(deviceId));
  const safeUserAgent = sanitizeSpreadsheetText_(userAgent, 250);

  return DB.withLock(() => {
    // 1. Re-validate session
    const session = DB.getSessionByToken(sessionToken);
    if (!session || session.status !== CONFIG.STATUS.SESSION.OPEN) {
      return { success: false, error: 'Session is invalid or closed.' };
    }
    const now = new Date();
    if (now < session.opensAt) {
      return { success: false, error: 'Session has not opened yet.' };
    }
    if (now > session.closesAt) {
      return { success: false, error: 'Session has expired.' };
    }

    const studentHeaders = DB.ensureStudentSchema();
    DB.ensureCheckinSchema();

    // 2. Prevent repeat attendance by student or browser device.
    const existingCheckin = DB.getCheckin(session.sessionId, normalizedRollNo);
    if (existingCheckin) {
      return {
        success: false,
        duplicate: true,
        sameDevice: Boolean(existingCheckin.deviceHash && existingCheckin.deviceHash === deviceHash),
        time: existingCheckin.timestamp
      };
    }

    const deviceCheckin = DB.getCheckinByDevice(session.sessionId, deviceHash);
    if (deviceCheckin) {
      return {
        success: false,
        deviceBlocked: true,
        error: 'This device has already submitted attendance for this session. Only one attendance is allowed per device.'
      };
    }

    const ss = getAttendanceSpreadsheet();
    const studentsSheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
    const dashboard = ss.getSheetByName(CONFIG.SHEETS.DASHBOARD);
    const checkinsSheet = ss.getSheetByName(CONFIG.SHEETS.CHECKINS);

    // 3. Handle Registration / Student Lookup
    let student = DB.getStudentByRollNo(normalizedRollNo);
    let studentRowInDashboard = -1;

    if (!student) {
      if (!isNewRegistration) return { success: false, error: 'Student not found.' };
      if (!fullName) return { success: false, error: 'Full name required for registration.' };
      if (!officialEmail) return { success: false, error: 'Official college email required for registration.' };

      // Register new student
      const studentId = 'STU-' + now.getTime();
      const rawApprovalSetting = getSetting('New registrations require approval');
      const status = (String(rawApprovalSetting).toUpperCase() === 'TRUE') 
        ? CONFIG.STATUS.STUDENT.PENDING 
        : CONFIG.STATUS.STUDENT.ACTIVE;

      const studentRow = Array(studentHeaders.length).fill('');
      studentRow[studentHeaders.indexOf('Student ID')] = studentId;
      studentRow[studentHeaders.indexOf('Roll Number')] = normalizedRollNo;
      studentRow[studentHeaders.indexOf('Full Name')] = fullName;
      studentRow[studentHeaders.indexOf('Status')] = status;
      studentRow[studentHeaders.indexOf('Registered At')] = now;
      studentRow[studentHeaders.indexOf('Created By')] = 'System';
      studentRow[studentHeaders.indexOf('Official Email')] = officialEmail;
      studentRow[studentHeaders.indexOf(CONFIG.GENDER.HEADER)] = submittedGender;
      studentsSheet.appendRow(studentRow);

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
      const storedGender = String(student.gender || '');
      if (storedGender && normalizeGender(storedGender) !== storedGender) {
        return attendanceError_('INVALID_GENDER', 'Your profile needs administrator review before attendance can be recorded.');
      }
      if (!storedGender) {
        if (!submittedGender) {
          return attendanceError_('GENDER_REQUIRED', 'Select Male or Female to continue.');
        }
        studentsSheet.getRange(student.row, studentHeaders.indexOf(CONFIG.GENDER.HEADER) + 1)
          .setValue(submittedGender);
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
      checkinId, now, session.sessionId, session.date, normalizedRollNo, fullName,
      'Present', 'QR Web App', safeUserAgent, deviceHash
    ]);

    return { success: true };
  });
}

function attendanceError_(code, message, retryable) {
  return { success: false, valid: false, code, error: message, retryable: retryable === true };
}

/**
 * Sanitizes untrusted text before writing it to Google Sheets.
 * @param {*} value
 * @param {number} maxLength
 * @returns {string}
 */
function sanitizeSpreadsheetText_(value, maxLength) {
  let text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maxLength);
  if (/^\s*[=+@-]/.test(text)) text = "'" + text.slice(0, Math.max(0, maxLength - 1));
  return text;
}

/**
 * Neutralizes formula-like user agents left by older deployments.
 */
function sanitizeExistingCheckinUserAgents_() {
  const ss = getAttendanceSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CHECKINS);
  if (!sheet || sheet.getLastRow() < 2) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const userAgentColumn = headers.indexOf('User Agent') + 1;
  if (userAgentColumn < 1) return;

  const range = sheet.getRange(2, userAgentColumn, sheet.getLastRow() - 1, 1);
  const values = range.getValues();
  const formulas = range.getFormulas();
  let changed = false;
  const sanitized = values.map((row, index) => {
    const original = formulas[index][0] || row[0];
    const safe = sanitizeSpreadsheetText_(original, 250);
    if (formulas[index][0] || safe !== String(row[0] || '')) changed = true;
    return [safe];
  });
  if (changed) range.setValues(sanitized);
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
    
  if (response !== ui.Button.YES) return;

  DB.withLock(() => {
    const ss = getAttendanceSpreadsheet();

    const sessions = ss.getSheetByName(CONFIG.SHEETS.SESSIONS);
    if (sessions && sessions.getLastRow() > 1) {
      sessions.getRange(2, 1, sessions.getLastRow() - 1, sessions.getLastColumn()).clearContent();
    }

    const checkins = ss.getSheetByName(CONFIG.SHEETS.CHECKINS);
    if (checkins && checkins.getLastRow() > 1) {
      checkins.getRange(2, 1, checkins.getLastRow() - 1, checkins.getLastColumn()).clearContent();
    }

    const dashboard = ss.getSheetByName(CONFIG.SHEETS.DASHBOARD);
    if (dashboard && dashboard.getLastColumn() > 3) {
      dashboard.deleteColumns(4, dashboard.getLastColumn() - 3);
    }
  });

  ui.alert('Data reset successfully! Your student list is preserved, but all test sessions have been erased.');
}
