"""Disposable HTTP regression for team/route CSV tools and balanced random routes."""
from __future__ import annotations

import csv
import http.cookiejar
import io
import json
import secrets
import sqlite3
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

import qa_suite

ROOT = Path(__file__).resolve().parent
TEAM_HEADERS = ["team_name", "team_colour", "member_count", "team_access_code"]
ROUTE_HEADERS = ["team_name", "team_colour"] + [f"level_{n}_{f}" for n in range(1, 5) for f in ("station", "envelope_code", "organizer_note")]
COLOURS = qa_suite.COLOURS


def form_upload(server, path: str, content: bytes):
    boundary = "SignalHuntTestBoundary" + secrets.token_hex(8)
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"fixture.csv\"\r\n"
        "Content-Type: text/csv\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(
        server.base + path,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "X-CSRF-Token": server.csrf},
        method="POST",
    )
    try:
        with server.opener.open(request, timeout=15) as response:
            payload = response.read()
            return response.status, json.loads(payload or b"{}")
    except urllib.error.HTTPError as error:
        payload = error.read()
        try:
            data = json.loads(payload)
        except Exception:
            data = {"detail": payload.decode("utf-8", errors="replace")}
        return error.code, data


def csv_text(headers, rows, comment=None):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(rows)
    prefix = "# " + comment + "\n" if comment else ""
    return ("\ufeff" + prefix + output.getvalue()).encode("utf-8")


def team_rows(count: int):
    return [(f"QA Team {i+1}", COLOURS[i], "3", qa_suite.new_code()) for i in range(count)]


def route_rows(teams):
    rows = []
    codes = {}
    for index, (name, colour, _size, _team_code) in enumerate(teams):
        values = [name, colour]
        for level, station in enumerate("ABCD", start=1):
            code = qa_suite.new_code("E")
            codes[(index + 1, level)] = code
            note = f"QA note, team {index+1}, level {level}"
            if index == 0 and level == 1:
                note = '=HYPERLINK("https://invalid.example")\ncontinued note'
            values.extend([station, code, note])
        rows.append(values)
    return rows, codes


def test_team_csv(server):
    status, template = server.call("GET", "/api/admin/csv-template/teams", admin=True)
    assert status == 200 and "# Replace or remove" in template and "team_access_code" in template
    teams = team_rows(4)
    valid = csv_text(TEAM_HEADERS, teams)
    status, preview = form_upload(server, "/api/admin/teams/import/preview", valid)
    assert status == 200 and len(preview["preview"]) == 4
    status, result = form_upload(server, "/api/admin/teams/import/confirm", valid)
    assert status == 200 and result["imported"] == 4
    assert len(server.call("GET", "/api/admin/overview", admin=True)[1]["teams"]) == 4

    cases = [
        (b"wrong,headers\nX,Y\n", "header"),
        (b"", "empty"),
        (b"team_name,team_colour,member_count,team_access_code\n\"unterminated,red,3,Abcdefgh\n", "quote"),
        (csv_text(TEAM_HEADERS, [("Bad", "not-a-colour", "3", "Abcdefgh123")]), "colour"),
        (csv_text(TEAM_HEADERS, [("Bad", "red", "6", "Abcdefgh123")]), "member"),
        (csv_text(TEAM_HEADERS, [("QA Team 1", "purple", "3", "Othercode123")]), "existing-name"),
        (csv_text(TEAM_HEADERS, [("Other", "white", "3", teams[0][3])]), "existing-code"),
    ]
    for fixture, _label in cases:
        status, _ = form_upload(server, "/api/admin/teams/import/preview", fixture)
        assert status in (409, 422), (_label, status)

    bad_last = csv_text(TEAM_HEADERS, [("QA New", "purple", "3", qa_suite.new_code()), ("Bad Row", "invalid", "3", qa_suite.new_code())], "Replace or remove example")
    status, error = form_upload(server, "/api/admin/teams/import/confirm", bad_last)
    assert status == 422 and "row 4" in error["detail"].lower(), error
    assert len(server.call("GET", "/api/admin/overview", admin=True)[1]["teams"]) == 4, "invalid import must not partially insert"
    status, _ = form_upload(server, "/api/admin/teams/import/preview", b"\xff\xfe")
    assert status == 422
    status, _ = form_upload(server, "/api/admin/teams/import/preview", b"x" * 1_000_001)
    assert status == 413
    print("team CSV: template, valid preview/import, header/row/code/colour/size/encoding/size limits and rollback PASS")
    return teams


def test_routes_and_participant(server, teams, database):
    status, template = server.call("GET", "/api/admin/csv-template/routes", admin=True)
    assert status == 200 and "A, B, C or D" in template and len(next(csv.reader(io.StringIO(template.lstrip("\ufeff").split("\n", 1)[1])))) == 14
    rows, codes = route_rows(teams)
    valid = csv_text(ROUTE_HEADERS, rows)
    status, preview = form_upload(server, "/api/admin/routes/import/preview", valid)
    assert status == 200 and len(preview["preview"]) == 16

    bad_station = [list(row) for row in rows]; bad_station[0][2] = "CANTEEN"
    bad_duplicate_code = [list(row) for row in rows]; bad_duplicate_code[0][5] = bad_duplicate_code[0][3]
    bad_unknown_team = [list(row) for row in rows]; bad_unknown_team[0][0] = "Unknown"
    bad_missing = [list(row) for row in rows]; bad_missing[0][4] = ""
    for fixture in (bad_station, bad_duplicate_code, bad_unknown_team, bad_missing):
        status, _ = form_upload(server, "/api/admin/routes/import/preview", csv_text(ROUTE_HEADERS, fixture))
        assert status in (409, 422), status

    status, result = form_upload(server, "/api/admin/routes/import/confirm?replace_existing=false", valid)
    assert status == 200 and result["imported"] == 16
    status, current = form_upload(server, "/api/admin/routes/import/confirm?replace_existing=false", valid)
    assert status == 409, current
    status, result = form_upload(server, "/api/admin/routes/import/confirm?replace_existing=true", valid)
    assert status == 200 and result["imported"] == 16

    # Exercise spreadsheet-formula escaping on names and notes in the exported file.
    with sqlite3.connect(database) as c:
        c.execute("UPDATE teams SET name=? WHERE id=1", ('=HYPERLINK("https://invalid.example")',))

    status, exported = server.call("GET", "/api/admin/routes/export", admin=True)
    assert status == 200
    exported_rows = list(csv.DictReader(io.StringIO(exported)))
    assert len(exported_rows) == 4
    assert all(not row[f"level_{level}_envelope_code"] for row in exported_rows for level in range(1, 5))
    assert "pbkdf2_sha256" not in exported and all(code not in exported for code in codes.values())
    assert exported_rows[0]["team_name"].startswith("'")
    assert exported_rows[0]["level_1_organizer_note"].startswith("'")
    assert "continued note" in exported_rows[0]["level_1_organizer_note"]

    status, _ = server.call("POST", "/api/admin/game/start", admin=True)
    assert status == 200
    team_code = teams[0][3]
    device = "qa-csv-device-1"
    status, login = server.call("POST", "/api/login", {"code": team_code, "colour": teams[0][1], "device_id": device})
    assert status == 200, login
    other_team_code = codes[(2, 1)]
    status, wrong = server.call("POST", "/api/submit", {"code": team_code, "device_id": device, "envelope_code": other_team_code})
    assert status == 200 and wrong.get("correct") is False
    for level in range(1, 5):
        status, submitted = server.call("POST", "/api/submit", {"code": team_code, "device_id": device, "envelope_code": codes[(1, level)]})
        assert status == 200 and submitted.get("correct") is True, (level, status, submitted)
    status, private = server.call("GET", "/api/team/current", headers={"X-Team-Code": team_code, "X-Device-ID": device})
    assert status == 200 and "station_id" not in json.dumps(private) and "organizer_notes" not in json.dumps(private)
    print("route CSV: valid preview/import/replacement, validation, safe export, participant verification and route confidentiality PASS")


def test_generator(count: int, persist=False):
    with tempfile.TemporaryDirectory(prefix=f"signal-hunt-routes-{count}-", ignore_cleanup_errors=True) as temp:
        server = qa_suite.LocalServer("demo", Path(temp) / "routes.db")
        try:
            team_ids = []
            for index, colour in enumerate(COLOURS[:count]):
                payload = {"name": f"Route Team {index+1}", "colour": colour, "code": qa_suite.new_code(), "team_size": 3}
                status, result = server.call("POST", "/api/admin/teams", payload, admin=True)
                assert status == 200, result
                team_ids.append(result["id"])
                for level, station in enumerate("ABCD", start=1):
                    status, _ = server.call("PUT", f"/api/admin/teams/{result['id']}/levels/{level}", {"station_id": station, "riddle_notes": f"private note {index}-{level}", "envelope_code": qa_suite.new_code("E")}, admin=True)
                    assert status == 200
            with sqlite3.connect(Path(temp) / "routes.db") as db:
                before = db.execute("SELECT team_id,level,station_id,envelope_code_hash,riddle_notes FROM team_levels ORDER BY team_id,level").fetchall()
            for _ in range(20):
                status, response = server.call("POST", "/api/admin/routes/random/preview", {}, admin=True)
                assert status == 200
                assignments = response["preview"]
                assert len(assignments) == count and {item["team_id"] for item in assignments} == set(team_ids)
                assert all(len(item["stations"]) == 4 and set(item["stations"]) == set("ABCD") for item in assignments)
                for level in range(4):
                    stations = [item["stations"][level] for item in assignments]
                    assert max(stations.count(s) for s in "ABCD") - min(stations.count(s) for s in "ABCD") <= 1
            with sqlite3.connect(Path(temp) / "routes.db") as db:
                assert db.execute("SELECT team_id,level,station_id,envelope_code_hash,riddle_notes FROM team_levels ORDER BY team_id,level").fetchall() == before, "preview mutated persisted route assignments"
            if persist:
                status, response = server.call("POST", "/api/admin/routes/random/confirm", {"assignments": assignments}, admin=True)
                assert status == 200, response
                with sqlite3.connect(Path(temp) / "routes.db") as db:
                    after = db.execute("SELECT team_id,level,station_id,envelope_code_hash,riddle_notes FROM team_levels ORDER BY team_id,level").fetchall()
                assert [(r[0], r[1], r[3], r[4]) for r in before] == [(r[0], r[1], r[3], r[4]) for r in after]
            else:
                malformed = {"assignments": [{"team_id": team_ids[0], "stations": ["A", "B", "B", "D"]}]}
                assert server.call("POST", "/api/admin/routes/random/confirm", malformed, admin=True)[0] == 422
            print(f"balanced generator: {count} teams × 20 trials; uniqueness, balance, no-preview-write" + (" and station-only persistence" if persist else " and malformed input rejection") + " PASS")
        finally:
            server.stop()


def test_ten_team_csv():
    with tempfile.TemporaryDirectory(prefix="signal-hunt-teams-10-", ignore_cleanup_errors=True) as temp:
        database = Path(temp) / "teams.db"
        server = qa_suite.LocalServer("main", database)
        try:
            rows = team_rows(10)
            status, preview = form_upload(server, "/api/admin/teams/import/preview", csv_text(TEAM_HEADERS, rows))
            assert status == 200 and len(preview["preview"]) == 10
            status, result = form_upload(server, "/api/admin/teams/import/confirm", csv_text(TEAM_HEADERS, rows))
            assert status == 200 and result["imported"] == 10
            assert len(server.call("GET", "/api/admin/overview", admin=True)[1]["teams"]) == 10
            with sqlite3.connect(database) as db:
                db.execute("UPDATE game_state SET status='active' WHERE id=1")
            status, _ = server.call("POST", "/api/admin/event/reset", {"confirm": "RESET EVENT"}, admin=True)
            assert status == 409, "full event reset must be blocked while active"
            with sqlite3.connect(database) as db:
                db.execute("UPDATE game_state SET status='waiting' WHERE id=1")
                key_path = Path(str(database) + ".lookup-key")
                key_before = key_path.read_bytes()
            status, reset = server.call("POST", "/api/admin/event/reset", {"confirm": "RESET EVENT"}, admin=True)
            assert status == 200, reset
            backup = Path(temp) / "backups" / reset["backup_file"]
            backup_key = Path(str(backup) + ".lookup-key")
            assert backup.is_file() and backup_key.read_bytes() == key_before
            with sqlite3.connect(backup) as db:
                assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
                assert db.execute("SELECT COUNT(*) FROM teams").fetchone()[0] == 10
                assert db.execute("SELECT COUNT(*) FROM private_meta WHERE key='lookup_key_fingerprint'").fetchone()[0] == 1
            with sqlite3.connect(database) as db:
                assert db.execute("SELECT COUNT(*) FROM teams").fetchone()[0] == 0
                assert db.execute("SELECT status FROM game_state WHERE id=1").fetchone()[0] == "waiting"
            assert len(server.call("GET", "/api/admin/overview", admin=True)[1]["teams"]) == 0
            print("event reset: active-state block, verified database/key backup, atomic setup reset and waiting state PASS")
            print("team CSV: exact 10-team event boundary PASS")
        finally:
            server.stop()


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="signal-hunt-bulk-", ignore_cleanup_errors=True) as temp:
        database = Path(temp) / "bulk.db"
        server = qa_suite.LocalServer("demo", database)
        try:
            imported = test_team_csv(server)
            test_routes_and_participant(server, imported, database)
        finally:
            server.stop()
    test_ten_team_csv()
    for size in (4, 5, 6, 10):
        test_generator(size, persist=(size == 10))
    print("Bulk tools and randomized routes regression PASS")
