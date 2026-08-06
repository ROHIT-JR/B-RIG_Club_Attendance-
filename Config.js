/**
 * Configuration and constants for the Attendance System.
 */
const CONFIG = {
  SHEETS: {
    DASHBOARD: 'Attendance Dashboard',
    STUDENTS: 'Students',
    SESSIONS: 'Sessions',
    CHECKINS: 'Checkins',
    SETTINGS: 'Settings'
  },
  DEFAULT_SETTINGS: {
    'Club Name': 'Student Club',
    'Public Web App URL': 'Paste your web app URL here',
    'New registrations require approval': 'FALSE',
    'Default attendance window in minutes': '60',
    'Time zone': 'Asia/Kolkata',
    'Version': '1.0.0'
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
