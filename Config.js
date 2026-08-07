/**
 * Configuration and constants for the Attendance System.
 */
const CONFIG = {
  ROLL_NUMBER: {
    PATTERN: /^CB\.SC\.U4([A-Z]{3})(\d{2})(\d{3})$/,
    EXAMPLE: 'CB.SC.U4CYS25048'
  },
  ACCESS_CONTROL: {
    QR_LIFETIME_SECONDS: 25,
    QR_REFRESH_SECONDS: 10,
    GRANT_LIFETIME_SECONDS: 300
  },
  DEVICE_ID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
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
 * Checks the institutional roll-number structure.
 * Format: CB.SC.U4 + department (3 letters) + joining year (2 digits) + roll (3 digits).
 * @param {string} rollNo
 * @returns {boolean}
 */
function isValidRollNo(rollNo) {
  return CONFIG.ROLL_NUMBER.PATTERN.test(normalizeRollNo(rollNo));
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
    !/[\u0000-\u001f\u007f]/.test(normalized);
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
  const match = value.match(/^https:\/\/([A-Za-z0-9.-]+)(?::\d+)?(?:\/[^\s#]*)?$/);
  if (!match) return false;

  const hostname = match[1].toLowerCase();
  const blockedHosts = [
    'script.google.com',
    'script.googleusercontent.com',
    'drive.google.com'
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
 * Gets a setting value from the Settings sheet.
 * @param {string} key 
 * @returns {string}
 */
function getSetting(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
  if (isValidStudentAppUrl(studentUrl)) return String(studentUrl).trim();

  const legacyUrl = getSetting('Public Web App URL');
  return isValidStudentAppUrl(legacyUrl) ? String(legacyUrl).trim() : '';
}
