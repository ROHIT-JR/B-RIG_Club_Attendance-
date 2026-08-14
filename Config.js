/**
 * Configuration and constants for the Attendance System.
 */
const CONFIG = {
  ROLL_NUMBER: {
    MIN_LENGTH: 8,
    MAX_LENGTH: 32,
    PATTERN: /^CB\.[A-Z0-9.]+$/,
    EXAMPLE: 'CB.EN.U4EEE25048'
  },
  OFFICIAL_EMAIL_DOMAIN: 'cb.students.amrita.edu',
  ACCESS_CONTROL: {
    QR_LIFETIME_SECONDS: 25,
    QR_REFRESH_SECONDS: 10,
    GRANT_LIFETIME_SECONDS: 300
  },
  DEVICE_ID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  STUDENT_BASE_HEADERS: [
    'Student ID', 'Roll Number', 'Full Name', 'Status', 'Registered At',
    'Created By', 'Notes', 'Official Email'
  ],
  STUDENT_HEADERS: [
    'Student ID', 'Roll Number', 'Full Name', 'Status', 'Registered At',
    'Created By', 'Notes', 'Official Email', 'Gender'
  ],
  GENDER: {
    HEADER: 'Gender',
    VALUES: ['Male', 'Female']
  },
  CHECKIN_HEADERS: [
    'Checkin ID', 'Timestamp', 'Session ID', 'Session Date', 'Roll Number',
    'Full Name', 'Result', 'Source', 'User Agent', 'Device ID'
  ],
  SHEETS: {
    DASHBOARD: 'Attendance Dashboard',
    STUDENTS: 'Students',
    SESSIONS: 'Sessions',
    CHECKINS: 'Checkins',
    SETTINGS: 'Settings'
  },
  DEFAULT_SETTINGS: {
    'Club Name': 'Student Club',
    'Student Web App URL': 'Paste your Vercel student URL here',
    'New registrations require approval': 'FALSE',
    'Default attendance window in minutes': '60',
    'Time zone': 'Asia/Kolkata',
    'Version': '2.0.0'
  },
  STATUS: {
    STUDENT: {
      ACTIVE: 'Active',
      PENDING: 'Pending',
      INACTIVE: 'Inactive'
    },
    SESSION: {
      DRAFT: 'Draft',
      OPEN: 'Open',
      CLOSED: 'Closed'
    }
  },
  MARKERS: {
    PRESENT: 'P',
    ABSENT: 'A',
    PRE_REGISTRATION: '—'
  }
};

/**
 * Normalizes a roll number for consistent lookups.
 * @param {string} rollNo 
 * @returns {string}
 */
function normalizeRollNo(rollNo) {
  if (!rollNo) return '';
  return String(rollNo).trim().toUpperCase();
}

/**
 * Checks a safe generalized Coimbatore-campus roll-number syntax.
 * @param {string} rollNo
 * @returns {boolean}
 */
function isValidRollNo(rollNo) {
  const normalized = normalizeRollNo(rollNo);
  return normalized.length >= CONFIG.ROLL_NUMBER.MIN_LENGTH &&
    normalized.length <= CONFIG.ROLL_NUMBER.MAX_LENGTH &&
    CONFIG.ROLL_NUMBER.PATTERN.test(normalized) &&
    !normalized.includes('..') &&
    !normalized.endsWith('.');
}

/**
 * Returns the official college email associated with a valid roll number.
 * @param {string} rollNo
 * @returns {string}
 */
function getOfficialEmailForRollNo(rollNo) {
  const normalizedRollNo = normalizeRollNo(rollNo);
  return isValidRollNo(normalizedRollNo)
    ? `${normalizedRollNo.toLowerCase()}@${CONFIG.OFFICIAL_EMAIL_DOMAIN}`
    : '';
}

/**
 * Normalizes an official college email for comparison and storage.
 * @param {string} email
 * @returns {string}
 */
function normalizeOfficialEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Requires the official email local part to equal the student's roll number.
 * @param {string} email
 * @param {string} rollNo
 * @returns {boolean}
 */
function isValidOfficialEmail(email, rollNo) {
  const expectedEmail = getOfficialEmailForRollNo(rollNo);
  return Boolean(expectedEmail) && normalizeOfficialEmail(email) === expectedEmail;
}

/**
 * Normalizes a student's name while preventing spreadsheet formula injection.
 * @param {string} fullName
 * @returns {string}
 */
function normalizeFullName(fullName) {
  return String(fullName || '').trim().replace(/\s+/g, ' ');
}

/**
 * Validates a name before writing it to Google Sheets.
 * @param {string} fullName
 * @returns {boolean}
 */
function isValidFullName(fullName) {
  const normalized = normalizeFullName(fullName);
  return normalized.length >= 2 &&
    normalized.length <= 80 &&
    !/^[=+@-]/.test(normalized) &&
    !/@/.test(normalized) &&
    !/[\u0000-\u001f\u007f]/.test(normalized);
}

function normalizeGender(gender) {
  const normalized = String(gender || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const match = CONFIG.GENDER.VALUES.find(value => value.toLowerCase() === normalized);
  return match || '';
}

function isValidGender(gender) {
  return Boolean(normalizeGender(gender));
}

/**
 * Hashes a browser identifier before it is stored in the attendance log.
 * @param {string} deviceId
 * @returns {string}
 */
function hashDeviceId(deviceId) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    deviceId,
    Utilities.Charset.UTF_8
  );
  return digest.map(byte => (byte + 256).toString(16).slice(-2)).join('');
}

/**
 * Accepts an HTTPS student frontend while rejecting Google-hosted script URLs.
 * @param {string} url
 * @returns {boolean}
 */
function isValidStudentAppUrl(url) {
  const value = String(url || '').trim();
  const match = value.match(/^https:\/\/([A-Za-z0-9.-]+)(?::(\d{1,5}))?\/?$/);
  if (!match) return false;

  const hostname = match[1].toLowerCase();
  const port = match[2] ? Number(match[2]) : null;
  const labels = hostname.split('.');
  if (hostname.length > 253 || labels.length < 2 || labels.some(label =>
    !label || label.length > 63 || label.startsWith('-') || label.endsWith('-')
  )) return false;
  if (port !== null && (port < 1 || port > 65535)) return false;
  if (labels.every(label => /^(?:\d+|0x[0-9a-f]+)$/i.test(label))) return false;

  const blockedHosts = [
    'google.com',
    'googleusercontent.com',
    'googleapis.com',
    'gstatic.com',
    'withgoogle.com',
    'appspot.com',
    'firebaseapp.com',
    'web.app',
    'github.io'
  ];
  return !blockedHosts.some(host => hostname === host || hostname.endsWith('.' + host));
}

/**
 * Detects the legacy Apps Script student URL during migration.
 * @param {string} url
 * @returns {boolean}
 */
function isAppsScriptWebAppUrl(url) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?(?:\?.*)?$/.test(
    String(url || '').trim()
  );
}

/**
 * Returns the attendance workbook in both bound-editor and web-app executions.
 * Workbook setup records the bound Sheet ID for contexts with no active file.
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
let attendanceSpreadsheet_ = null;

function getAttendanceSpreadsheet() {
  if (attendanceSpreadsheet_) return attendanceSpreadsheet_;

  const properties = PropertiesService.getScriptProperties();
  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSpreadsheet) {
    if (typeof activeSpreadsheet.getId === 'function') {
      const activeId = activeSpreadsheet.getId();
      if (activeId && properties.getProperty('SPREADSHEET_ID') !== activeId) {
        properties.setProperty('SPREADSHEET_ID', activeId);
      }
    }
    attendanceSpreadsheet_ = activeSpreadsheet;
    return attendanceSpreadsheet_;
  }

  const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) {
    const error = new Error('Attendance workbook is not configured. Run workbook setup from the bound Google Sheet.');
    error.name = 'AttendanceConfigurationError';
    throw error;
  }
  try {
    attendanceSpreadsheet_ = SpreadsheetApp.openById(spreadsheetId);
    return attendanceSpreadsheet_;
  } catch (error) {
    console.error('Could not open the configured attendance workbook:', error);
    const configurationError = new Error('Attendance workbook could not be opened by the deployed Apps Script account.');
    configurationError.name = 'AttendanceConfigurationError';
    throw configurationError;
  }
}

/**
 * Gets a setting value from the Settings sheet.
 * @param {string} key 
 * @returns {string}
 */
function getSetting(key) {
  const ss = getAttendanceSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
  if (!sheet) return CONFIG.DEFAULT_SETTINGS[key] || '';
  
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === key) {
      return data[i][1];
    }
  }
  return CONFIG.DEFAULT_SETTINGS[key] || '';
}

/**
 * Returns the configured student frontend URL, with a safe legacy-setting fallback.
 * @returns {string}
 */
function getStudentAppUrl() {
  const studentUrl = getSetting('Student Web App URL');
  if (isValidStudentAppUrl(studentUrl)) return String(studentUrl).trim().replace(/\/$/, '');

  const legacyUrl = getSetting('Public Web App URL');
  return isValidStudentAppUrl(legacyUrl) ? String(legacyUrl).trim().replace(/\/$/, '') : '';
}
