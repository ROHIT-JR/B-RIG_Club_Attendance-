(() => {
  'use strict';

  const API_ENDPOINT = '/api/attendance';
  const ROLL_NUMBER_PATTERN = /^CB\.SC\.U4[A-Z]{3}\d{2}\d{3}$/;
  const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const DEVICE_STORAGE_KEY = 'brig_device_id';
  const ATTENDANCE_RECEIPT_PREFIX = 'brig_attended_';
  const REQUEST_TIMEOUT_MS = 30000;
  const BUTTON_LABELS = {
    continue: 'Continue securely',
    confirm: 'Confirm attendance',
    register: 'Register and check in',
    retry: 'Try again'
  };

  const urlParams = new URLSearchParams(window.location.search);
  const state = {
    sessionToken: urlParams.get('session') || '',
    accessCode: urlParams.get('access') || '',
    accessExpires: urlParams.get('expires') || '',
    accessGrant: '',
    rollNumber: '',
    fullName: '',
    deviceId: getOrCreateDeviceId()
  };

  const views = {
    loading: document.getElementById('view-loading'),
    invalid: document.getElementById('view-invalid'),
    rollInput: document.getElementById('view-roll-input'),
    confirm: document.getElementById('view-confirm'),
    register: document.getElementById('view-register'),
    success: document.getElementById('view-success')
  };

  const elements = {
    attendanceCard: document.getElementById('attendance-card'),
    invalidTitle: document.getElementById('invalid-title'),
    invalidReason: document.getElementById('invalid-reason'),
    invalidHelp: document.getElementById('invalid-help'),
    btnRetrySession: document.getElementById('btn-retry-session'),
    clubTitle: document.getElementById('club-title'),
    sessionTitle: document.getElementById('session-title'),
    sessionDate: document.getElementById('session-date'),
    formRoll: document.getElementById('form-roll'),
    rollNumber: document.getElementById('rollNumber'),
    rollError: document.getElementById('roll-error'),
    btnRollContinue: document.getElementById('btn-roll-continue'),
    confirmAvatar: document.getElementById('confirm-avatar'),
    confirmName: document.getElementById('confirm-name'),
    confirmRoll: document.getElementById('confirm-roll'),
    formConfirm: document.getElementById('form-confirm'),
    confirmError: document.getElementById('confirm-error'),
    btnConfirmAttendance: document.getElementById('btn-confirm-attendance'),
    btnConfirmBack: document.getElementById('btn-confirm-back'),
    formRegister: document.getElementById('form-register'),
    regRollNumber: document.getElementById('regRollNumber'),
    regFullName: document.getElementById('regFullName'),
    registerError: document.getElementById('register-error'),
    btnRegisterAttendance: document.getElementById('btn-register-attendance'),
    btnRegisterBack: document.getElementById('btn-register-back'),
    successTitle: document.getElementById('success-title'),
    successMessage: document.getElementById('success-message')
  };

  function createUuid() {
    const cryptoApi = window.crypto;
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') return '';
    if (typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();

    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }

  function getOrCreateDeviceId() {
    try {
      let deviceId = window.localStorage.getItem(DEVICE_STORAGE_KEY);
      if (!deviceId || !DEVICE_ID_PATTERN.test(deviceId)) {
        deviceId = createUuid();
        if (!deviceId) return '';
        window.localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
      }
      return deviceId;
    } catch (error) {
      return '';
    }
  }

  function hasAttendanceReceipt() {
    if (!state.sessionToken) return false;
    try {
      return window.localStorage.getItem(ATTENDANCE_RECEIPT_PREFIX + state.sessionToken) === 'recorded';
    } catch (error) {
      return false;
    }
  }

  function saveAttendanceReceipt() {
    try {
      window.localStorage.setItem(ATTENDANCE_RECEIPT_PREFIX + state.sessionToken, 'recorded');
    } catch (error) {
      // Server-side roll and device checks remain authoritative.
    }
  }

  function focusSoon(element) {
    if (!element) return;
    window.requestAnimationFrame(() => element.focus({ preventScroll: true }));
  }

  function showView(viewName, focusTarget) {
    Object.values(views).forEach(view => {
      view.classList.remove('active');
      view.classList.add('hidden');
    });
    views[viewName].classList.remove('hidden');
    views[viewName].classList.add('active');
    elements.attendanceCard.setAttribute('aria-busy', viewName === 'loading' ? 'true' : 'false');
    focusSoon(focusTarget);
  }

  function showError(element, message) {
    element.textContent = message;
    element.classList.remove('hidden');
  }

  function hideError(element) {
    element.textContent = '';
    element.classList.add('hidden');
  }

  function setButtonLoading(button, isLoading, label) {
    button.disabled = isLoading;
    button.classList.toggle('is-loading', isLoading);
    button.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    button.textContent = isLoading ? 'Please wait' : label;
  }

  function showInvalid(message, options = {}) {
    const retryable = options.retryable === true;
    elements.invalidReason.textContent = message;
    elements.invalidHelp.textContent = options.help || 'Scan the current attendance QR code to open a fresh check-in link.';
    elements.btnRetrySession.classList.toggle('hidden', !retryable);
    setButtonLoading(elements.btnRetrySession, false, BUTTON_LABELS.retry);
    showView('invalid', elements.invalidTitle);
  }

  function makeRequestError(message, retryable) {
    const error = new Error(message);
    error.retryable = retryable;
    return error;
  }

  async function postAttendance(payload) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      : null;
    let response;

    try {
      response = await window.fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        cache: 'no-store',
        referrerPolicy: 'same-origin',
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined
      });
    } catch (error) {
      const message = navigator.onLine === false
        ? 'You appear to be offline. Check your connection and try again.'
        : 'The attendance service could not be reached. Check your connection and try again.';
      throw makeRequestError(message, true);
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw makeRequestError('The attendance service returned an unreadable response. Please try again.', true);
    }

    if (!response.ok) {
      const message = data && (data.error || data.reason)
        ? String(data.error || data.reason)
        : 'The attendance service could not complete this request.';
      const retryable = typeof data.retryable === 'boolean'
        ? data.retryable
        : response.status === 408 || response.status === 429 || response.status >= 500;
      throw makeRequestError(message, retryable);
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw makeRequestError('The attendance service returned an unexpected response. Please try again.', true);
    }
    return data;
  }

  async function loadSessionDetails() {
    state.accessGrant = '';
    showView('loading');

    if (!state.sessionToken) {
      showInvalid('No attendance session was provided in this link.');
      return;
    }
    if (!state.accessCode || !state.accessExpires) {
      showInvalid('This check-in link is incomplete or has expired.');
      return;
    }
    if (!state.deviceId) {
      showInvalid(
        'This browser cannot save the protected device receipt required for check-in.',
        { help: 'Allow site storage or open the QR link in a standard browser window, then scan the code again.' }
      );
      return;
    }

    try {
      const response = await postAttendance({
        action: 'sessionDetails',
        sessionToken: state.sessionToken,
        accessCode: state.accessCode,
        accessExpires: state.accessExpires,
        deviceId: state.deviceId
      });

      if (!response.valid) {
        showInvalid(response.reason || response.error || 'This attendance session is unavailable.', {
          retryable: response.retryable === true,
          help: response.retryable === true
            ? 'Retry when your connection is stable, or scan the current QR code for a fresh link.'
            : undefined
        });
        return;
      }
      if (!response.accessGrant || typeof response.accessGrant !== 'string') {
        showInvalid(
          'This check-in link could not be verified. Please try once more.',
          { retryable: true }
        );
        return;
      }

      state.accessGrant = response.accessGrant;
      elements.clubTitle.textContent = `${response.clubName || 'B-RIG'} check-in`;
      elements.sessionTitle.textContent = response.title || 'Attendance session';
      elements.sessionDate.textContent = response.date || '';

      if (hasAttendanceReceipt()) {
        state.accessGrant = '';
        elements.successMessage.textContent = 'Attendance has already been submitted from this browser for this session.';
        showView('success', elements.successTitle);
        return;
      }

      showView('rollInput', elements.rollNumber);
    } catch (error) {
      showInvalid(error.message, {
        retryable: error.retryable === true,
        help: error.retryable === true
          ? 'Retry when your connection is stable, or scan the current QR code for a fresh link.'
          : 'Contact the club administrator if the current QR continues to fail.'
      });
    }
  }

  function resetIdentity() {
    state.rollNumber = '';
    state.fullName = '';
    elements.rollNumber.value = '';
    elements.regRollNumber.value = '';
    elements.regFullName.value = '';
    hideError(elements.rollError);
    hideError(elements.confirmError);
    hideError(elements.registerError);
    showView('rollInput', elements.rollNumber);
  }

  function recordedTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function handleAttendanceResponse(response, errorElement) {
    if (response.success || response.duplicate) {
      if (response.success || response.sameDevice) saveAttendanceReceipt();
      state.accessGrant = '';
      if (response.duplicate) {
        const time = recordedTime(response.time);
        elements.successMessage.textContent = time
          ? `Attendance was already recorded at ${time}.`
          : 'Attendance was already recorded for this session.';
      } else {
        elements.successMessage.textContent = response.message || 'Your attendance was recorded successfully.';
      }
      showView('success', elements.successTitle);
      createCelebration();
      return;
    }

    if (response.deviceBlocked) {
      saveAttendanceReceipt();
      state.accessGrant = '';
      showInvalid(
        response.error || 'This browser has already submitted attendance for this session.',
        { help: 'Only one attendance is allowed per browser device for each session.' }
      );
      return;
    }

    const message = response.error || 'Attendance could not be recorded. Please try again.';
    showError(errorElement, response.retryable ? `${message} It is safe to try again.` : message);
  }

  async function submitAttendance(isNewRegistration, errorElement, button, backButton, label) {
    if (!state.deviceId) {
      showError(errorElement, 'Browser storage is unavailable. Allow site storage or use a standard browser window, then try again.');
      return;
    }
    if (!state.accessGrant) {
      showError(errorElement, 'Your secure check-in has expired. Scan the current attendance QR code again.');
      return;
    }
    if (hasAttendanceReceipt()) {
      showError(errorElement, 'Attendance has already been submitted from this browser for this session.');
      return;
    }

    setButtonLoading(button, true, label);
    backButton.disabled = true;
    try {
      const response = await postAttendance({
        action: 'submitAttendance',
        sessionToken: state.sessionToken,
        rollNumber: state.rollNumber,
        fullName: state.fullName,
        isNewRegistration,
        deviceId: state.deviceId,
        userAgent: navigator.userAgent.slice(0, 250),
        accessGrant: state.accessGrant
      });
      handleAttendanceResponse(response, errorElement);
    } catch (error) {
      const retryMessage = error.retryable
        ? `${error.message} It is safe to tap the check-in button again.`
        : error.message;
      showError(errorElement, retryMessage);
    } finally {
      setButtonLoading(button, false, label);
      backButton.disabled = false;
    }
  }

  function createCelebration() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const celebration = document.createElement('div');
    celebration.className = 'celebration';
    celebration.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 18; index += 1) {
      const particle = document.createElement('span');
      particle.className = 'celebration-particle';
      celebration.appendChild(particle);
    }
    document.body.appendChild(celebration);
    window.setTimeout(() => celebration.remove(), 1800);
  }

  elements.rollNumber.addEventListener('input', event => {
    event.target.value = event.target.value.toUpperCase().replace(/\s/g, '').slice(0, 16);
    hideError(elements.rollError);
  });

  elements.formRoll.addEventListener('submit', async event => {
    event.preventDefault();
    hideError(elements.rollError);

    const rollNumber = elements.rollNumber.value.trim().toUpperCase();
    if (!ROLL_NUMBER_PATTERN.test(rollNumber)) {
      showError(elements.rollError, 'Use CB.SC.U4CYS25048 format: 3 department letters, 2 joining-year digits, and 3 roll digits.');
      elements.rollNumber.focus();
      return;
    }
    if (!state.accessGrant) {
      showError(elements.rollError, 'Your secure check-in has expired. Scan the current attendance QR code again.');
      return;
    }

    state.rollNumber = rollNumber;
    setButtonLoading(elements.btnRollContinue, true, BUTTON_LABELS.continue);
    try {
      const response = await postAttendance({
        action: 'validateRoll',
        rollNumber,
        sessionToken: state.sessionToken,
        deviceId: state.deviceId,
        accessGrant: state.accessGrant
      });

      if (!response.valid) {
        showError(elements.rollError, response.error || 'This roll number could not be verified.');
        return;
      }

      state.rollNumber = response.rollNumber || rollNumber;
      if (response.exists) {
        state.fullName = response.fullName || '';
        if (!state.fullName) {
          showError(elements.rollError, 'Your student profile could not be loaded. Please try again.');
          return;
        }
        elements.confirmName.textContent = state.fullName;
        elements.confirmRoll.textContent = state.rollNumber;
        elements.confirmAvatar.textContent = state.fullName.charAt(0).toUpperCase();
        showView('confirm', elements.btnConfirmAttendance);
        return;
      }

      state.fullName = '';
      elements.regRollNumber.value = state.rollNumber;
      elements.regFullName.value = '';
      showView('register', elements.regFullName);
    } catch (error) {
      const retryMessage = error.retryable
        ? `${error.message} Tap Continue securely to retry.`
        : error.message;
      showError(elements.rollError, retryMessage);
    } finally {
      setButtonLoading(elements.btnRollContinue, false, BUTTON_LABELS.continue);
    }
  });

  elements.formConfirm.addEventListener('submit', event => {
    event.preventDefault();
    hideError(elements.confirmError);
    submitAttendance(
      false,
      elements.confirmError,
      elements.btnConfirmAttendance,
      elements.btnConfirmBack,
      BUTTON_LABELS.confirm
    );
  });

  elements.formRegister.addEventListener('submit', event => {
    event.preventDefault();
    hideError(elements.registerError);

    const fullName = elements.regFullName.value.trim().replace(/\s+/g, ' ');
    if (fullName.length < 2) {
      showError(elements.registerError, 'Enter your full official name.');
      elements.regFullName.focus();
      return;
    }

    state.fullName = fullName;
    submitAttendance(
      true,
      elements.registerError,
      elements.btnRegisterAttendance,
      elements.btnRegisterBack,
      BUTTON_LABELS.register
    );
  });

  elements.btnConfirmBack.addEventListener('click', resetIdentity);
  elements.btnRegisterBack.addEventListener('click', resetIdentity);
  elements.btnRetrySession.addEventListener('click', loadSessionDetails);

  window.addEventListener('online', () => {
    if (views.invalid.classList.contains('active') && !elements.btnRetrySession.classList.contains('hidden')) {
      elements.invalidReason.textContent = 'Your connection is back. Try verifying the attendance session again.';
      focusSoon(elements.btnRetrySession);
    }
  });

  loadSessionDetails();
})();
