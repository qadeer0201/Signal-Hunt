# Final QA summary

## Result

**Release source and disposable test environment passed the requested local checks.** No live Render service was created and no persistent user event database was reset. The final ZIP is assembled separately from the source and excludes test databases and credentials.

## Fixes included

- Participant answer polling now preserves partially typed text and cursor focus. Empty and incorrect answers remain retryable, and successful answers are submitted once.
- Expired participant sessions return to sign-in with a clear message.
- Local organizer credentials are setup-only and stored as salted hashes; hosted deployments use `ADMIN_PASSWORD`.
- The app has one event configuration, 4–10 teams, up to 50 registered participant devices, one database path and one Render blueprint.
- Organizer tools include team edit/delete, CSV preview/confirm, balanced randomized routes, pause/resume/finish, progress re-arm and backed-up event reset.
- Knowledge detail layout, mission layout and enlarged campus map viewer were polished.

## Automated checks

- Full backend QA suite: 120 grouped checks passed across five legacy fixture profiles; profiles no longer select runtime data. Concurrency smoke passed at 10, 25, 50 and 100 participant requests and a 52-request mixed participant/organizer batch with no request errors. This is a smoke test, not a sustained event-load test.
- Bulk tools and reset suite: passed, including active-event reset blocking, verified backup, ten-team boundary and 20 balanced-route trials for each of 4, 5, 6 and 10 teams.
- Local organizer password persistence suite: passed, including restart without `ADMIN_PASSWORD`.
- Participant entry and fullscreen-change regression tests: passed.
- Static HTML/assets audit, Python compilation, frontend JavaScript syntax checks, PowerShell parser check, and Render YAML audit: passed.
- Campus map asset SHA-256 matched the original: `5D11F2E55512E78F3C0BB0BD62884E8863D2C8D8B24CEF4F38290858186A11AB`.

## Browser walkthrough

Using a disposable local database, an organizer created four test teams, configured routes, started the event and re-armed progress. A participant signed in and completed all four levels through the real API. At every level, empty input, slow character-by-character typing during a polling tick, and an incorrect code were checked before submitting the correct code. Text and focus survived polling, incorrect codes allowed retries, and all four correct codes recorded completion. Session expiry returned the participant to sign-in.

The participant mission and Knowledge screens were visually inspected at 1280×720. The final Knowledge detail alignment was rechecked after the CSS update. The campus map opened in an enlarged overlay and closed by its button and Escape. The organizer dashboard was visually inspected at 665×572; its document width matched its viewport width (650 CSS pixels), with no horizontal overflow. A separate 1280×720 organizer screenshot check was not completed.

## Package and deployment limits

The local test server used a disposable database under the QA runtime folder. No real event database was changed. The Render configuration was audited locally, but a cloud deploy, public HTTPS rehearsal, real-device rehearsal, hosted disk persistence/recovery, and sustained load test remain operator tasks. The first-run ZIP launcher must also be validated from a clean extracted copy; internet access is needed for its one-time package installation.
