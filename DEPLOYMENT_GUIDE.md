# Deployment guide — one Signal Hunt website

This release is configured as one hosted website and one event database. The checked-in `render.yaml` creates a Render web service named `signal-hunt-nexus-vyoma`, one paid Starter instance, and a 1 GB persistent disk mounted at `/data`. SQLite, the code lookup key, and reset backups must remain on that same disk. Keep one instance: the application relies on a local SQLite database, rate-limit state and in-memory organizer sessions.

## Deploy on Render

1. Put the extracted release in a private Git repository and connect that repository to Render. Review the repository contents before pushing; do not include `.env`, databases, lookup keys, backups, or local virtual environments.
2. In Render, create a Blueprint deployment from that repository and select `render.yaml`.
3. When prompted for `ADMIN_PASSWORD`, set a new unique secret at least 12 characters long. Save it in Render's environment settings. Never reuse a team code, envelope code, or password previously shared in chat.
4. Confirm the service uses one instance and that the persistent disk is mounted at `/data`. The app binds to Render's `PORT`; the health check is `/api/status`.
5. Wait for the deployment health check, then open the provided HTTPS address. Test organizer sign-in, participant login, and a full test event using disposable codes before the real event.

Render documents persistent disks as available on paid services, with one attached disk per service; disk-backed services support one instance. [Persistent disks](https://render.com/docs/disks) Render's Blueprint `sync: false` field prompts for a secret on initial creation; edit a changed secret in the service's dashboard environment settings. [Blueprint environment variables](https://render.com/docs/blueprint-spec) Render web services must bind to `0.0.0.0` and the assigned `PORT`; this Docker image does that. [Web services](https://render.com/docs/web-services) The configured health endpoint returns a successful response for Render's health checks. [Health checks](https://render.com/docs/health-checks)

## Data protection and recovery

The database path is `/data/signalhunt.db`; its `.lookup-key` sidecar is also stored on the persistent disk. Back up both together while the application is stopped or using a consistent SQLite backup procedure. Treat these files as credentials: they contain event records and enable validation of stored team/envelope-code hashes.

The organizer's **Reset Event Setup** action creates and verifies a database/key backup in `/data/backups` before clearing the event records. It is a reset workflow, not a standalone backup button or a scheduled backup. Render disk snapshots are whole-disk recovery points, not database-level backups; Render says snapshots are taken daily and retained for seven days, so arrange and verify an independent backup strategy appropriate to the event. [Persistent disk snapshots and recovery](https://render.com/docs/disks#disk-snapshots)

Before the event, rehearse recovery using a separate test service or local copy. Restore the database and matching key as a pair, verify the organizer can sign in, then confirm expected teams and routes. Do not experiment with restoration on the live event disk.

## Local operation

For the local Windows launcher, see [README.md](README.md). It listens on `127.0.0.1:8014` by default and stores data under the project folder's `data` directory. Local operation is not remotely accessible unless deliberately placed behind a configured secure network service.

## Not included in this deployment

This package does not create or deploy a hosted service. The hosted deployment, public URL, real organizer secret, event-day devices, and disk restore procedure must be configured and rehearsed by the event operator.
