# Production Testing Checklist

Use this checklist before the first production meeting and after architecture, deployment, authentication, or Sheet-schema changes. Automated tests do not replace a real mobile scan through deployed Vercel and Apps Script services.

## Automated Verification

From the repository root:

```bash
npm ci
npm test
```

Optional focused commands:

```bash
npm run test:apps-script
npm --prefix vercel test
```

The automated suite covers signed QR generation, root-origin validation, browser-bound grants, roll validation, registration, duplicate and device enforcement, spreadsheet formula sanitization, API authentication, request validation, secret redaction, timeout behavior, rate limiting, security headers, and forbidden frontend dependencies.

The suite does not deploy Apps Script, configure Vercel, access a real Sheet, test Workspace policy, validate a custom DNS record, or reproduce mobile browser storage behavior.

## Predeployment

- [ ] `npm test` passes from a clean dependency installation.
- [ ] `git diff --check` reports no whitespace errors.
- [ ] No real `.clasp.json`, `.env`, API secret, Apps Script deployment URL, or student export is staged.
- [ ] Apps Script has a `VERCEL_API_SECRET` Script Property containing at least 32 random characters.
- [ ] The Apps Script production deployment executes as the administrator and permits access by Anyone.
- [ ] Vercel Root Directory is exactly `vercel`.
- [ ] Vercel Production has `APPS_SCRIPT_URL` and `APPS_SCRIPT_API_SECRET`.
- [ ] `APPS_SCRIPT_API_SECRET` exactly matches `VERCEL_API_SECRET`.
- [ ] The latest Apps Script source is published as a new deployment version.
- [ ] The latest frontend and API commit is deployed to Vercel.

## Workbook Setup

- [ ] Run **Club Attendance > Setup / Initialise Workbook**.
- [ ] `Attendance Dashboard`, `Students`, `Sessions`, `Checkins`, and `Settings` exist.
- [ ] Re-running setup preserves records except that formula-like historical `User Agent` cells are converted to safe text.
- [ ] `Checkins` has the standard columns ending with `User Agent` and `Device ID`.
- [ ] `Student Web App URL` contains only the stable Vercel/custom root HTTPS origin.
- [ ] `Club Name`, `Time zone`, default duration, and registration approval behavior are correct.
- [ ] The Sheet time zone, `Settings > Time zone`, and `appsscript.json` `timeZone` match.
- [ ] Only trusted administrators can edit the Sheet and its settings.

## Architecture Boundary

- [ ] Open the student base origin without parameters. It asks for a fresh QR instead of loading attendance.
- [ ] Create a fresh session and decode the displayed QR before scanning it.
- [ ] The decoded QR host is the configured Vercel or custom domain.
- [ ] The QR has `session`, `access`, and `expires` parameters.
- [ ] The QR has no `script.google.com`, `script.googleusercontent.com`, `authuser`, GitHub Pages, or `qr.html` reference.
- [ ] Browser developer tools show all attendance API requests going only to same-origin `/api/attendance`; permitted font and image assets may use their CSP-listed origins.
- [ ] The student page source and network requests expose neither server environment variable nor API secret.
- [ ] Open the QR while two or more Google accounts are signed in. The student form opens directly with no Google chooser, Drive page, authorization prompt, or private-window workaround.
- [ ] Repeat the multi-account scan on a second browser or phone if available.

## Vercel API

- [ ] `GET /api/attendance` returns `405` and advertises POST.
- [ ] A normal scan returns JSON through `/api/attendance`; it never redirects the browser to Google.
- [ ] Temporarily test a staging deployment with a wrong secret. The browser receives generic administrator guidance and no URL, secret, stack, or Google HTML.
- [ ] Restore the correct secret and redeploy staging before continuing.
- [ ] Confirm the Vercel function duration is 30 seconds and the proxy timeout is shorter than the browser timeout.
- [ ] Confirm a Vercel Firewall rate-limit rule protects POST `/api/attendance` if global distributed limiting is required.
- [ ] Verify the firewall threshold permits expected attendance volume from one shared campus IP.
- [ ] Use automated or staging tests for repeated-request limits. Do not intentionally flood production Apps Script.

## QR Security

- [ ] Watch the admin QR for at least 30 seconds. It refreshes repeatedly and the countdown remains accurate.
- [ ] Disconnect the administrator network briefly in staging. The dialog displays a reconnecting state and retries automatically.
- [ ] Reconnect before the session ends. QR rotation recovers without reopening the dialog.
- [ ] Block cdnjs in staging and reopen the admin dialog. QR rendering fails closed with no unverified or stale QR presented as live.
- [ ] Photograph a QR, wait at least 30 seconds, then scan the image. The student app rejects it as expired.
- [ ] Change one character in `access`. The link is rejected.
- [ ] Change `session` without replacing the signature. The link is rejected.
- [ ] Remove `access` or `expires`. The app requests a fresh scan.
- [ ] Scan a valid QR, wait for visible QR rotation, and submit within five minutes. Submission succeeds.
- [ ] In staging, wait more than five minutes after scanning and submit. The app requires a fresh QR.
- [ ] Close the session while a granted page is open. Its final submission is rejected.
- [ ] Move `Closes At` into the past. QR refresh stops and previously granted submission is rejected.

## Roll Validation

- [ ] Enter `cb.sc.u4cys25048`. It normalizes to `CB.SC.U4CYS25048`.
- [ ] Enter another valid department such as `CB.SC.U4CSE25048`. It is accepted.
- [ ] Enter `CS21045`. The old format is rejected.
- [ ] Enter `CB.SC.U4CYS2548`. A three-digit roll sequence is required.
- [ ] Enter `CB.SC.U4CY25048`. A three-letter department is required.
- [ ] Enter spaces or extra characters. Browser and server validation reject the value.

## Registration

- [ ] Create `Week 1` and scan its live QR with a normal persistent browser.
- [ ] Enter an unknown valid roll.
- [ ] The app requests the student's full official name.
- [ ] Empty, one-character, control-character, and formula-like names are rejected.
- [ ] Submit a valid name and reach the success screen.
- [ ] The `Students` row contains the normalized roll, name, expected Active/Pending status, and timestamp.
- [ ] The `Checkins` row contains the session, roll, submitted registration name, source, sanitized user agent, and a 64-character device hash.
- [ ] The raw browser UUID is not present in the Sheet.
- [ ] The dashboard adds the student and marks the current session `P`.
- [ ] Earlier session columns for a newly registered student contain the pre-registration marker.
- [ ] With approval enabled, a Pending student receives an approval-pending message on a later session.
- [ ] Change that student's `Status` to `Active`; a fresh scan then follows the existing-student confirmation flow.

## Existing Student

- [ ] Create `Week 2`. The dashboard adds a new session column and marks existing students `A`.
- [ ] Scan the fresh Week 2 QR and enter the registered roll.
- [ ] The confirmation view displays the Sheet's trusted student name and roll.
- [ ] Select **Confirm attendance** and reach success.
- [ ] The dashboard changes the Week 2 value from `A` to `P`.
- [ ] Exactly one `Checkins` row is created for the submission.

## Duplicate and Device Enforcement

- [ ] Rescan after a successful check-in in the same persistent browser. The local receipt opens the already-submitted state.
- [ ] Clear only the local receipt in a staging browser while preserving the device UUID, then resubmit the same roll. The server reports the duplicate and restores the local receipt.
- [ ] On another phone, enter a roll already checked in from the first phone. The server reports a duplicate and creates no row.
- [ ] After that different-device duplicate, scan a fresh QR on the second phone and enter the second student's own unused roll. The prior duplicate did not poison that browser's receipt.
- [ ] In the same browser that completed attendance, attempt a second unused roll after obtaining a fresh QR. The server blocks the device.
- [ ] The blocked attempt creates no student, check-in, or dashboard mutation.
- [ ] Submit the same roll simultaneously from two phones. `LockService` permits only one check-in row.
- [ ] Submit two different valid rolls simultaneously from two phones. Both serialize safely without corrupting rows.

The browser UUID is a deterrent rather than hardware identity. Clearing all site data, changing browsers, or using another device can create a different UUID; this limitation is expected.

## Session Administration

- [ ] **Show Current QR Code** reopens the latest open session.
- [ ] **Close Current Session** changes one open session to Closed and prevents attendance.
- [ ] Closing while another attendance write is active does not produce a partial write.
- [ ] Canceling **Reset / Clear All Sessions** changes nothing.
- [ ] In a disposable workbook, confirming reset clears sessions, check-ins, and dashboard session columns while retaining students and settings.
- [ ] Starting reset while another write is active waits for the write lock before clearing data.
- [ ] The reset procedure and backup recovery plan account for a possible partial reset if a Google Sheets operation fails mid-process.

## Failure Recovery

- [ ] Disable the phone network before opening a QR. The page gives retryable connection guidance.
- [ ] Restore the network and use **Try again**. Session validation recovers.
- [ ] Disable the network during final submission. The button is re-enabled and explains that retrying is safe.
- [ ] Retry after an uncertain submission. Server duplicate checks prevent a second row.
- [ ] A malformed or non-JSON upstream response produces generic retry guidance with no Google HTML.
- [ ] A missing Vercel environment variable produces administrator guidance without naming or exposing secret values.
- [ ] A busy Apps Script lock can finish within the proxy budget; a true timeout returns a retryable error rather than hanging indefinitely.

## Mobile and Accessibility

- [ ] Test current iOS Safari and Android Chrome using the phone's normal browser.
- [ ] Test a narrow viewport around 320 CSS pixels with no horizontal scrolling.
- [ ] Test a notched device or simulator. Content respects top, bottom, left, and right safe areas.
- [ ] Focus text fields on iOS. The 16-pixel input text does not trigger unwanted page zoom.
- [ ] Open and close the mobile keyboard. Fields, errors, and buttons remain reachable.
- [ ] Rotate between portrait and landscape. No content is clipped.
- [ ] Navigate with a keyboard. Focus order and visible focus indicators are usable.
- [ ] Screen-reader status announcements identify loading, QR failure, validation errors, and success.
- [ ] Enable reduced motion. View transitions, loaders, and celebration animation are effectively disabled.
- [ ] Text, footer, error, and button contrast remain readable outdoors and in dark mode.

## Upgrade and Legacy Removal

- [ ] Upgrade a copy of an existing workbook and run initialization.
- [ ] Existing students, sessions, check-ins, custom settings, and dashboard values remain intact except for the documented historical `User Agent` safety rewrite.
- [ ] Missing `Student Web App URL` and `Device ID` fields are added without reordering data.
- [ ] Formula-like values in historical `User Agent` cells are neutralized as text during initialization.
- [ ] An old Apps Script value in `Public Web App URL` cannot generate a student QR.
- [ ] The production Sheet uses `Student Web App URL`, not the migration fallback.
- [ ] `Index.html`, `ClientScript.html`, `Styles.html`, and `qr.html` are absent from the deployed source.
- [ ] Any old GitHub Pages redirect is disabled or returns not found after the deletion reaches its Pages source.
- [ ] Previously shared legacy links are not referenced by a current session, document, poster, or bookmark.

## Production Acceptance

- [ ] A fresh QR goes directly to the Vercel/custom frontend on desktop and mobile.
- [ ] Students never see `script.google.com`, a Google account chooser, an Apps Script error, or a Drive error.
- [ ] Students with multiple Google accounts need no sign-out, account choice, or private browsing.
- [ ] Registration, known-student confirmation, duplicate handling, and device blocking work against the real Sheet.
- [ ] Secrets exist only in Apps Script Script Properties and Vercel server environment variables.
- [ ] Vercel and Apps Script application logs contain no API secret or unnecessary personal data; access to short-lived QR request metadata is restricted.
- [ ] Administrators know how to close a session, recover the QR dialog, and recognize backend configuration failure.
- [ ] A backup or rollback plan exists before the first production session.

Record the tested commit, Apps Script deployment version, Vercel deployment, student hostname, devices, browsers, date, tester, and any accepted limitations with the release notes.
