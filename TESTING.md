# Testing Checklist

Follow these steps to verify the attendance system before production use.

## Setup Verification
- [ ] Initialize workbook from the custom menu. All 5 sheets exist and have headers.
- [ ] Dashboard first row and first 3 columns are frozen.
- [ ] Web App URL is populated in the `Settings` sheet.
- [ ] `Checkins` includes both `User Agent` and `Device ID` headers.

## Roll Number Validation
- [ ] Enter `cb.sc.u4cys25048`. Verify it is normalized to `CB.SC.U4CYS25048`.
- [ ] Enter another valid three-letter department, such as `CB.SC.U4CSE25048`. Verify it is accepted.
- [ ] Enter `CS21045`. Verify the form rejects the old format.
- [ ] Enter `CB.SC.U4CYS2548`. Verify the form requires a three-digit roll sequence.
- [ ] Enter `CB.SC.U4CY25048`. Verify the form requires a three-letter department.

## Registration & First Check-in
- [ ] Create a New Session ("Week 1"). Verify QR shows up.
- [ ] Watch the administrator QR for at least 15 seconds. Verify it refreshes automatically and displays an expiration countdown.
- [ ] Scan the live QR. Verify the page loads cleanly.
- [ ] Enter a new Roll Number (e.g. `CB.SC.U4CYS25048`).
- [ ] Verify system asks for Registration (Full Name).
- [ ] Submit registration. Verify Success screen.
- [ ] Check `Students` sheet: New student is listed as Active/Pending.
- [ ] Check `Checkins` sheet: Log entry created.
- [ ] Check `Attendance Dashboard`: Student row added, 'P' marked for today, and conditionally formatted green.

## Existing Student Check-in
- [ ] Create a second Session ("Week 2"). Verify Dashboard adds new column and marks existing student 'A' (red).
- [ ] Scan the live Week 2 QR.
- [ ] Enter Roll Number `CB.SC.U4CYS25048`.
- [ ] Verify system says "Is this you?" with the student's name and avatar (first letter).
- [ ] Click "Confirm attendance". Verify Success screen.
- [ ] Check `Attendance Dashboard`: 'A' changes to 'P' and turns green.
- [ ] Verify earlier pre-registration dates for new students are marked '—' (gray).

## Edge Cases
- [ ] **Missing QR Access:** Open the Web App URL with only `?session=...` and no `access` or `expires` values. Verify the app asks for a new live QR scan.
- [ ] **Expired Shared Link:** Photograph a QR code, wait at least 30 seconds, and then scan the old image. Verify the app rejects it as expired.
- [ ] **Tampered Link:** Change one character in the `access` value. Verify the app rejects the link.
- [ ] **Unauthorized QR Refresh:** From the student page console, call `google.script.run.withSuccessHandler(console.log).getRotatingQrData('TOKEN', 'INVALID')`. Verify the response says the admin QR display is not authorized.
- [ ] **QR Rotation During Entry:** Scan a valid QR, wait for the admin QR to rotate, and complete attendance within five minutes. Verify the browser-bound grant still allows submission.
- [ ] **Expired Access Grant:** Scan a valid QR, wait longer than five minutes, and try to submit. Verify the app asks for a new live QR scan.
- [ ] **Duplicate Scan:** Scan the current Week 2 QR again, enter `CB.SC.U4CYS25048`, and confirm. Verify the system reports when attendance was already recorded.
- [ ] **Same-Device Proxy:** Scan the current QR again in the same browser and enter a second valid roll number such as `CB.SC.U4CYS25049`. Verify the system says only one attendance is allowed per device for the session.
- [ ] **Different-Device Duplicate:** Scan the current QR on another phone and enter `CB.SC.U4CYS25048`. Verify the original student's attendance is detected as a duplicate.
- [ ] **Device Audit:** Verify successful `Checkins` rows contain a 64-character hash under `Device ID`, not the raw browser UUID.
- [ ] **Invalid Token:** Manually alter the `session` value in a fresh signed link. Verify the signature check rejects the modified link.
- [ ] **Expired Session:** Manually edit `Closes At` to a past time. Verify the admin QR stops refreshing and a previously granted page cannot submit.
- [ ] **Closed Session:** Use the custom menu to close the session. Verify the admin QR becomes unavailable and a previously granted page cannot submit.
- [ ] **Simultaneous Scans:** (Optional) Open the same session on two different phones with different roll numbers and submit at the same time. `LockService` should queue both writes without corrupting sheet rows.
