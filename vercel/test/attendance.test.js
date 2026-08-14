'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const attendance = require('../api/attendance');
const { createHandler, DEFAULT_TIMEOUT_MS, MAX_BODY_BYTES } = attendance;

const VALID_ENV = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/test-deployment_123/exec',
  APPS_SCRIPT_API_SECRET: 'server-only-secret-at-least-32-characters'
};

function validSessionBody() {
  return {
    action: 'sessionDetails',
    sessionToken: 'session-token',
    accessCode: 'signed-access-code',
    accessExpires: '1786100000000',
    deviceId: '123e4567-e89b-42d3-a456-426614174000'
  };
}

function createRequest(body, overrides = {}) {
  return {
    method: overrides.method || 'POST',
    headers: {
      'content-type': 'application/json',
      ...(overrides.headers || {})
    },
    body
  };
}

function createResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: '',
    ended: false,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
    end(body) {
      this.body = body || '';
      this.ended = true;
    }
  };
}

async function invoke(handler, req) {
  const res = createResponse();
  await handler(req, res);
  assert.equal(res.ended, true);
  return res;
}

function jsonResponse(body, contentType = 'application/json; charset=utf-8') {
  return {
    ok: true,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-type' ? contentType : null;
      }
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    }
  };
}

test('allows only POST and advertises the allowed method', async () => {
  let fetched = false;
  const handler = createHandler({
    env: VALID_ENV,
    fetchImpl: async () => {
      fetched = true;
      return jsonResponse({ valid: true });
    }
  });

  const res = await invoke(handler, createRequest(validSessionBody(), { method: 'GET' }));

  assert.equal(res.statusCode, 405);
  assert.equal(res.getHeader('allow'), 'POST');
  assert.equal(fetched, false);
});

test('requires an application/json request', async () => {
  const handler = createHandler({ env: VALID_ENV, fetchImpl: async () => jsonResponse({}) });
  const res = await invoke(handler, createRequest('{}', { headers: { 'content-type': 'text/plain' } }));

  assert.equal(res.statusCode, 415);
});

test('rejects malformed JSON', async () => {
  const handler = createHandler({ env: VALID_ENV, fetchImpl: async () => jsonResponse({}) });
  const res = await invoke(handler, createRequest('{'));

  assert.equal(res.statusCode, 400);
});

test('rejects unsupported actions', async () => {
  const handler = createHandler({ env: VALID_ENV, fetchImpl: async () => jsonResponse({}) });
  const res = await invoke(handler, createRequest({ action: 'deleteSession' }));

  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body), { error: 'Unsupported action.' });
});

test('rejects missing required fields', async () => {
  const handler = createHandler({ env: VALID_ENV, fetchImpl: async () => jsonResponse({}) });
  const body = validSessionBody();
  delete body.deviceId;

  const res = await invoke(handler, createRequest(body));

  assert.equal(res.statusCode, 400);
});

test('requires an official email for first-time registration', async () => {
  const handler = createHandler({ env: VALID_ENV, fetchImpl: async () => jsonResponse({}) });
  const body = {
    action: 'submitAttendance',
    sessionToken: 'session-token',
    rollNumber: 'CB.SC.U4CYS25048',
    fullName: 'Test Student',
    isNewRegistration: true,
    deviceId: '123e4567-e89b-42d3-a456-426614174000',
    accessGrant: 'short-lived-grant'
  };

  const res = await invoke(handler, createRequest(body));

  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body), { error: 'Invalid request payload.' });
});

test('allows only Male or Female and requires Gender for first-time registration', async () => {
  let fetchCount = 0;
  const handler = createHandler({
    env: VALID_ENV,
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse({ success: true });
    }
  });
  const base = {
    action: 'submitAttendance',
    sessionToken: 'session-token',
    rollNumber: 'CB.SC.U4CYS25048',
    fullName: 'Test Student',
    officialEmail: 'cb.sc.u4cys25048@cb.students.amrita.edu',
    isNewRegistration: true,
    deviceId: '123e4567-e89b-42d3-a456-426614174000',
    accessGrant: 'short-lived-grant'
  };

  for (const gender of [undefined, '', 'Prefer not to say', 'Other', 'male']) {
    const body = { ...base };
    if (gender !== undefined) body.gender = gender;
    const res = await invoke(handler, createRequest(body));
    assert.equal(res.statusCode, 400);
  }
  assert.equal(fetchCount, 0);

  for (const gender of ['Male', 'Female']) {
    const res = await invoke(handler, createRequest({ ...base, gender }));
    assert.equal(res.statusCode, 200);
  }
  assert.equal(fetchCount, 2);
});

test('rejects oversized content-length and parsed bodies', async t => {
  const handler = createHandler({ env: VALID_ENV, fetchImpl: async () => jsonResponse({}) });

  await t.test('content-length', async () => {
    const res = await invoke(handler, createRequest(validSessionBody(), {
      headers: { 'content-length': String(MAX_BODY_BYTES + 1) }
    }));
    assert.equal(res.statusCode, 413);
  });

  await t.test('serialized body', async () => {
    const body = { ...validSessionBody(), padding: 'x'.repeat(MAX_BODY_BYTES) };
    const res = await invoke(handler, createRequest(body));
    assert.equal(res.statusCode, 413);
  });
});

test('rejects missing server configuration without contacting upstream', async t => {
  for (const [name, env] of [
    ['both variables', {}],
    ['Apps Script URL', { APPS_SCRIPT_API_SECRET: VALID_ENV.APPS_SCRIPT_API_SECRET }],
    ['API secret', { APPS_SCRIPT_URL: VALID_ENV.APPS_SCRIPT_URL }],
    ['short API secret', { ...VALID_ENV, APPS_SCRIPT_API_SECRET: 'too-short' }]
  ]) {
    await t.test(name, async () => {
      let fetched = false;
      const handler = createHandler({
        env,
        fetchImpl: async () => {
          fetched = true;
          return jsonResponse({});
        }
      });

      const res = await invoke(handler, createRequest(validSessionBody()));
      assert.equal(res.statusCode, 500);
      assert.equal(fetched, false);
      assert.deepEqual(JSON.parse(res.body), {
        error: 'Attendance is temporarily unavailable. Contact the club administrator.',
        retryable: false
      });
    });
  }
});

test('uses an upstream timeout longer than the Apps Script lock wait', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 25_000);
});

test('rate limits repeated requests by browser device before contacting Apps Script', async () => {
  let fetchCount = 0;
  const handler = createHandler({
    env: VALID_ENV,
    rateLimits: {
      perIp: 100,
      perDeviceAction: { sessionDetails: 2 }
    },
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse({ valid: true });
    }
  });
  const requestOptions = { headers: { 'x-forwarded-for': '203.0.113.8' } };

  assert.equal((await invoke(handler, createRequest(validSessionBody(), requestOptions))).statusCode, 200);
  assert.equal((await invoke(handler, createRequest(validSessionBody(), requestOptions))).statusCode, 200);
  const limited = await invoke(handler, createRequest(validSessionBody(), requestOptions));

  assert.equal(limited.statusCode, 429);
  assert.equal(limited.getHeader('retry-after'), '60');
  assert.match(JSON.parse(limited.body).error, /too many attendance requests/i);
  assert.equal(fetchCount, 2);
});

test('returns a generic 502 for upstream network failures', async () => {
  const handler = createHandler({
    env: VALID_ENV,
    fetchImpl: async () => {
      throw new Error(`failed at ${VALID_ENV.APPS_SCRIPT_URL} with ${VALID_ENV.APPS_SCRIPT_API_SECRET}`);
    }
  });

  const res = await invoke(handler, createRequest(validSessionBody()));

  assert.equal(res.statusCode, 502);
  assert.doesNotMatch(res.body, /script\.google\.com|server-only-secret-at-least-32-characters|Error:/);
});

test('returns a generic 502 for upstream HTML', async () => {
  const handler = createHandler({
    env: VALID_ENV,
    fetchImpl: async () => jsonResponse('<html>sign in</html>', 'text/html')
  });

  const res = await invoke(handler, createRequest(validSessionBody()));

  assert.equal(res.statusCode, 502);
  assert.deepEqual(JSON.parse(res.body), { error: 'Attendance service returned an invalid response.' });
});

test('maps an Apps Script authentication rejection to administrator guidance', async () => {
  const handler = createHandler({
    env: VALID_ENV,
    fetchImpl: async () => jsonResponse({ success: false, error: 'Request could not be processed.' })
  });

  const res = await invoke(handler, createRequest(validSessionBody()));

  assert.equal(res.statusCode, 502);
  assert.deepEqual(JSON.parse(res.body), {
    error: 'Attendance is temporarily unavailable. Contact the club administrator.',
    retryable: false
  });
});

test('returns a generic 504 when the upstream request times out', async () => {
  const handler = createHandler({
    env: VALID_ENV,
    timeoutMs: 5,
    fetchImpl: async (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })
  });

  const res = await invoke(handler, createRequest(validSessionBody()));

  assert.equal(res.statusCode, 504);
  assert.deepEqual(JSON.parse(res.body), { error: 'Attendance service timed out.' });
});

test('forwards validated fields with the server secret and never exposes it', async () => {
  let forwardedUrl;
  let forwardedOptions;
  const handler = createHandler({
    env: VALID_ENV,
    fetchImpl: async (url, options) => {
      forwardedUrl = url;
      forwardedOptions = options;
      return jsonResponse({
        success: true,
        apiSecret: VALID_ENV.APPS_SCRIPT_API_SECRET,
        nested: {
          echoedSecret: VALID_ENV.APPS_SCRIPT_API_SECRET,
          endpoint: VALID_ENV.APPS_SCRIPT_URL
        },
        stack: 'upstream stack'
      });
    }
  });
  const browserPayload = {
    action: 'submitAttendance',
    sessionToken: 'session-token',
    rollNumber: 'CB.SC.U4CYS25048',
    fullName: 'Test Student',
    officialEmail: 'cb.sc.u4cys25048@cb.students.amrita.edu',
    isNewRegistration: false,
    deviceId: '123e4567-e89b-42d3-a456-426614174000',
    userAgent: 'node-test',
    accessGrant: 'short-lived-grant'
  };

  const res = await invoke(handler, createRequest(browserPayload));
  const forwardedBody = JSON.parse(forwardedOptions.body);

  assert.equal(res.statusCode, 200);
  assert.equal(forwardedUrl, VALID_ENV.APPS_SCRIPT_URL);
  assert.equal(forwardedOptions.method, 'POST');
  assert.equal(forwardedOptions.redirect, 'follow');
  assert.equal(forwardedOptions.headers['Content-Type'], 'application/json');
  assert.ok(forwardedOptions.signal instanceof AbortSignal);
  assert.deepEqual(forwardedBody, {
    ...browserPayload,
    apiSecret: VALID_ENV.APPS_SCRIPT_API_SECRET
  });
  assert.equal(Object.prototype.hasOwnProperty.call(browserPayload, 'apiSecret'), false);
  assert.equal(JSON.parse(res.body).success, true);
  assert.doesNotMatch(res.body, /server-only-secret-at-least-32-characters|script\.google\.com|"stack"/);
  assert.equal(res.getHeader('cache-control'), 'no-store');
  assert.equal(res.getHeader('content-type'), 'application/json; charset=utf-8');
});
