# Testing Checklist

Follow these steps to verify the Attendance System works flawlessly.

## Setup Verification
- [ ] Initialize workbook from custom menu. All 5 sheets exist and have headers.
- [ ] Dashboard first row and first 3 columns are frozen.
- [ ] Web App URL is populated in the `Settings` sheet.

## Registration & First Check-in
- [ ] Create a New Session ("Week 1"). Verify QR shows up.
- [ ] Scan QR / Open URL. Verify page loads cleanly.
- [ ] Enter a new Roll Number (e.g. `101`).
- [ ] Verify system asks for Registration (Full Name).
- [ ] Submit registration. Verify Success screen.
- [ ] Check `Students` sheet: New student is listed as Active/Pending.
- [ ] Check `Checkins` sheet: Log entry created.
- [ ] Check `Attendance Dashboard`: Student row added, 'P' marked for today, and conditionally formatted green.

## Existing Student Check-in
- [ ] Create a second Session ("Week 2"). Verify Dashboard adds new column and marks existing student 'A' (red).
- [ ] Open Week 2 URL.
- [ ] Enter Roll Number `101`.
- [ ] Verify system says "Is this you?" with the student's name and avatar (first letter).
- [ ] Click "Confirm attendance". Verify Success screen.
- [ ] Check `Attendance Dashboard`: 'A' changes to 'P' and turns green.
- [ ] Verify earlier pre-registration dates for new students are marked '—' (gray).

## Edge Cases
- [ ] **Duplicate Scan:** Open Week 2 URL again, enter `101`, confirm. Verify system says "Your attendance was already recorded at [time]."
- [ ] **Invalid Token:** Manually alter the `?session=` token in the URL. Verify system says "Attendance is unavailable" (invalid session).
- [ ] **Expired Session:** Wait for the session duration to pass, OR manually edit the `Closes At` time in the `Sessions` sheet to a past time. Open URL. Verify system says "Attendance is unavailable" (expired).
- [ ] **Closed Session:** Use custom menu to "Close Current Session". Open URL. Verify system says "Attendance is unavailable" (closed).
- [ ] **Simultaneous Scans:** (Optional) Open the same session on two different phones/tabs with different roll numbers and hit submit at the exact same time. `LockService` will queue them and ensure both write successfully without corrupting sheet rows.
