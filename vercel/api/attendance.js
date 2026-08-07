'use strict';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_UPSTREAM_BYTES = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const APPS_SCRIPT_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

const ACTION_SCHEMAS = {
  sessionDetails: {
    requiredStrings: {
      sessionToken: 128,
      accessCode: 256,
      accessExpires: 32,
      deviceId: 64
    },
    optionalStrings: {},
    booleans: []
  },
  validateRoll: {
    requiredStrings: {
      rollNumber: 32,
      sessionToken: 128,
      deviceId: 64,
      accessGrant: 128
    },
    optionalStrings: {},
    booleans: []
  },
  submitAttendance: {
    requiredStrings: {
      sessionToken: 128,
      rollNumber: 32,
      deviceId: 64,
      accessGrant: 128
    },
    optionalStrings: {
      fullName: 80,
      userAgent: 250
    },
    booleans: ['isNewRegistration']
  }
};

function getHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) || undefined;

  const lowerName = name.toLowerCase();
  const key = Object.keys(headers).find(header => header.toLowerCase() === lowerName);
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(res, statusCode, body, additionalHeaders) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(additionalHeaders || {})) {
    res.setHeader(name, value);
  }
  res.end(JSON.stringify(body));
}

function parseJsonBody(body) {
  let rawBody;
  if (Buffer.isBuffer(body)) {
    if (body.length > MAX_BODY_BYTES) return { status: 413 };
    rawBody = body.toString('utf8');
  } else if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return { status: 413 };
    rawBody = body;
  }

  let parsed = body;
  if (rawBody !== undefined) {
    try {
      parsed = JSON.parse(rawBody);
    } catch (error) {
      return { status: 400 };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 400 };
  }

  try {
    const serialized = JSON.stringify(parsed);
    if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) {
      return { status: serialized ? 413 : 400 };
    }
  } catch (error) {
    return { status: 400 };
  }

  return { value: parsed };
}

function validateAndSelectPayload(body) {
  if (typeof body.action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTION_SCHEMAS, body.action)) {
    return null;
  }

  const schema = ACTION_SCHEMAS[body.action];
  const payload = { action: body.action };

  for (const [field, maxLength] of Object.entries(schema.requiredStrings)) {
    const value = body[field];
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
      return null;
    }
    payload[field] = value;
  }

  for (const [field, maxLength] of Object.entries(schema.optionalStrings)) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const value = body[field];
    if (typeof value !== 'string' || value.length > maxLength) return null;
    payload[field] = value;
  }

  for (const field of schema.booleans) {
    if (typeof body[field] !== 'boolean') return null;
    payload[field] = body[field];
  }

  if (body.action === 'submitAttendance' && body.isNewRegistration &&
      (typeof body.fullName !== 'string' || !body.fullName.trim())) {
    return null;
  }

  return payload;
}

function redactSensitiveJson(value, sensitiveValues) {
  if (typeof value === 'string') {
    return sensitiveValues.reduce(
      (result, sensitiveValue) => result.split(sensitiveValue).join('[redacted]'),
      value
    );
  }

  if (Array.isArray(value)) {
    return value.map(item => redactSensitiveJson(item, sensitiveValues));
  }

  if (!value || typeof value !== 'object') return value;

  const result = {};
  for (const [rawKey, child] of Object.entries(value)) {
    const normalizedKey = rawKey.toLowerCase().replace(/[_-]/g, '');
    if (normalizedKey === 'apisecret' || normalizedKey === 'stack' || rawKey === '__proto__') continue;

    const safeKey = redactSensitiveJson(rawKey, sensitiveValues);
    result[safeKey] = redactSensitiveJson(child, sensitiveValues);
  }
  return result;
}

function createHandler(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const env = options.env || process.env;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;

  return async function attendanceHandler(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
      return;
    }

    const contentType = String(getHeader(req.headers, 'content-type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== 'application/json') {
      sendJson(res, 415, { error: 'Content-Type must be application/json.' });
      return;
    }

    const contentLength = getHeader(req.headers, 'content-length');
    if (contentLength !== undefined) {
      const normalizedLength = String(contentLength).trim();
      if (!/^\d+$/.test(normalizedLength) || !Number.isSafeInteger(Number(normalizedLength))) {
        sendJson(res, 400, { error: 'Invalid request.' });
        return;
      }
      if (Number(normalizedLength) > MAX_BODY_BYTES) {
        sendJson(res, 413, { error: 'Request body is too large.' });
        return;
      }
    }

    const parsedBody = parseJsonBody(req.body);
    if (!parsedBody.value) {
      const status = parsedBody.status || 400;
      sendJson(
        res,
        status,
        { error: status === 413 ? 'Request body is too large.' : 'Malformed JSON body.' }
      );
      return;
    }

    const body = parsedBody.value;
    if (typeof body.action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTION_SCHEMAS, body.action)) {
      sendJson(res, 400, { error: 'Unsupported action.' });
      return;
    }

    const payload = validateAndSelectPayload(body);
    if (!payload) {
      sendJson(res, 400, { error: 'Invalid request payload.' });
      return;
    }

    const appsScriptUrl = typeof env.APPS_SCRIPT_URL === 'string' ? env.APPS_SCRIPT_URL.trim() : '';
    const apiSecret = typeof env.APPS_SCRIPT_API_SECRET === 'string' ? env.APPS_SCRIPT_API_SECRET : '';
    if (!APPS_SCRIPT_URL_PATTERN.test(appsScriptUrl) || apiSecret.length < 32) {
      sendJson(res, 500, { error: 'Server configuration error.' });
      return;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const upstreamResponse = await fetchImpl(appsScriptUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ...payload, apiSecret }),
        redirect: 'follow',
        signal: controller.signal
      });

      if (!upstreamResponse || !upstreamResponse.ok) {
        sendJson(res, 502, { error: 'Attendance service is temporarily unavailable.' });
        return;
      }

      const upstreamContentType = String(getHeader(upstreamResponse.headers, 'content-type') || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      const isJson = upstreamContentType === 'application/json' ||
        (upstreamContentType.startsWith('application/') && upstreamContentType.endsWith('+json'));
      if (!isJson) {
        sendJson(res, 502, { error: 'Attendance service returned an invalid response.' });
        return;
      }

      let upstreamBody;
      try {
        const upstreamText = await upstreamResponse.text();
        if (Buffer.byteLength(upstreamText, 'utf8') > MAX_UPSTREAM_BYTES) {
          sendJson(res, 502, { error: 'Attendance service returned an invalid response.' });
          return;
        }
        upstreamBody = JSON.parse(upstreamText);
      } catch (error) {
        sendJson(
          res,
          timedOut ? 504 : 502,
          { error: timedOut ? 'Attendance service timed out.' : 'Attendance service returned an invalid response.' }
        );
        return;
      }

      if (!upstreamBody || typeof upstreamBody !== 'object' || Array.isArray(upstreamBody)) {
        sendJson(res, 502, { error: 'Attendance service returned an invalid response.' });
        return;
      }

      sendJson(res, 200, redactSensitiveJson(upstreamBody, [apiSecret, appsScriptUrl]));
    } catch (error) {
      sendJson(
        res,
        timedOut ? 504 : 502,
        { error: timedOut ? 'Attendance service timed out.' : 'Attendance service is temporarily unavailable.' }
      );
    } finally {
      clearTimeout(timeout);
    }
  };
}

const handler = createHandler();

module.exports = handler;
module.exports.createHandler = createHandler;
module.exports.MAX_BODY_BYTES = MAX_BODY_BYTES;
