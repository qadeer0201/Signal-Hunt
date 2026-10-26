"""Repeatable local Signal Hunt QA smoke suite; all credentials and databases are disposable."""
from __future__ import annotations

import concurrent.futures
import json
import http.cookiejar
import os
import secrets
import statistics
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PYTHON = sys.executable
PASSWORD = "Q" + secrets.token_urlsafe(24)
COLOURS = ["red", "blue", "green", "yellow", "orange", "purple", "cyan", "white", "silver", "gold"]


def new_code(prefix="Q"):
    return prefix + secrets.token_hex(12).upper()


class LocalServer:
    def __init__(self, profile: str, db: Path):
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.port = self.sock.getsockname()[1]
        self.sock.close()
        self.base = f"http://127.0.0.1:{self.port}"
        self.csrf = ""
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        env = os.environ.copy()
        env.update({"EVENT_PROFILE": profile, "DATABASE_PATH": str(db), "ADMIN_PASSWORD": PASSWORD,
                    "STRICT_SECURITY": "1", "FRONTEND_DIR": str(ROOT / "Frontend"), "MAX_TEAMS": "10"})
        self.process = subprocess.Popen([PYTHON, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
                                         "--port", str(self.port)], cwd=ROOT / "Backend", env=env,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                self.call("GET", "/health")
                login_status, login_data = self.call("POST", "/api/admin/login", {"password": PASSWORD})
                if login_status != 200:
                    raise RuntimeError("Temporary host authentication failed")
                self.csrf = login_data["csrf_token"]
                return
            except Exception:
                if self.process.poll() is not None:
                    raise RuntimeError("Uvicorn exited during startup")
                time.sleep(.1)
        raise RuntimeError("Uvicorn did not become ready")

    def stop(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=3)

    def call(self, method: str, path: str, body=None, admin=False, headers=None, anonymous=False):
        raw = None if body is None else json.dumps(body).encode()
        request_headers = {"Content-Type": "application/json"} if raw is not None else {}
        if admin:
            if self.csrf:
                request_headers["X-CSRF-Token"] = self.csrf
        request_headers.update(headers or {})
        req = urllib.request.Request(self.base + path, data=raw, headers=request_headers, method=method)
        try:
            # Keep legacy contract assertions independent of the host cookie jar and
            # any participant cookie issued by /api/login. Cookie-session coverage
            # uses its own dedicated opener in check_participant_cookie_session().
            legacy_participant_request = path in {"/api/login", "/api/team/current", "/api/submit", "/api/violation"}
            opener = urllib.request.build_opener() if anonymous or legacy_participant_request else self.opener
            with opener.open(req, timeout=15) as response:
                payload = response.read()
                if not payload:
                    data = {}
                else:
                    try:
                        data = json.loads(payload)
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        data = payload.decode("utf-8", errors="replace")
                return response.status, data
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            try:
                data = json.loads(payload)
            except Exception:
                data = {"detail": "non-JSON error"}
            return exc.code, data


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def run_profile(profile: str, target_teams: int):
    results = []
    def record(name, fn):
        fn()
        results.append(name)

    with tempfile.TemporaryDirectory(prefix=f"signal-hunt-{profile}-qa-", ignore_cleanup_errors=True) as temp:
        db = Path(temp) / "isolated.db"
        server = LocalServer(profile, db)
        try:
            status, config = server.call("GET", "/api/config")
            record("clean database, profile, ten colours and limits", lambda: check(
                status == 200 and config["event_label"].startswith("One Signal Hunt event") and len(config["available_colours"]) == 10
                and config["min_teams"] == 4 and config["max_teams"] == 10 and config["max_participants"] == 50,
                "unexpected profile configuration"))
            record("participant/host/static map routes", lambda: check(
                all(server.call("GET", p)[0] == 200 for p in ["/", "/host.html", "/assets/campus-map.webp"]), "static route failed"))
            record("unauthorized host operation rejected", lambda: check(
                server.call("POST", "/api/admin/game/start", anonymous=True)[0] == 401, "unauthenticated start accepted"))
            record("organizer session, CSRF and two-host limit", lambda: check_host_sessions(server))
            record("below-minimum start rejected", lambda: check(
                server.call("POST", "/api/admin/game/start", admin=True)[0] == 409, "start below 4 accepted"))
            bad = {"name": "X", "colour": "unknown", "code": "bad", "team_size": 99}
            record("malformed team fields rejected", lambda: check(server.call("POST", "/api/admin/teams", bad, admin=True)[0] == 422,
                                                                   "invalid team fields accepted"))

            teams = []
            for i in range(target_teams):
                payload = {"name": f"QA Team {i+1}", "colour": COLOURS[i], "code": new_code(), "team_size": 5}
                code, data = server.call("POST", "/api/admin/teams", payload, admin=True)
                check(code == 200, "team create failed")
                teams.append((data["id"], payload["code"], f"qa-device-{i+1}"))
            record(f"create {target_teams} teams with unique colours/codes", lambda: check(len(teams) == target_teams, "team count mismatch"))
            record("duplicate team name, colour and code rejected", lambda: check(
                server.call("POST", "/api/admin/teams", {"name":"QA Team 1","colour":"gold","code":"unique-dupe-name","team_size":3}, admin=True)[0] == 409
                and server.call("POST", "/api/admin/teams", {"name":"Other QA","colour":"red","code":"unique-dupe-colour","team_size":3}, admin=True)[0] == 409
                and server.call("POST", "/api/admin/teams", {"name":"Other Team","colour":"gold","code":teams[0][1],"team_size":3}, admin=True)[0] == 409,
                "duplicate accepted"))
            rotated_code = new_code("R")
            record("team code rotation and invalidation", lambda: check(
                server.call("PUT", f"/api/admin/teams/{teams[0][0]}/code", {"code":rotated_code}, admin=True)[0] == 200
                and server.call("POST", "/api/login", {"code":teams[0][1],"device_id":teams[0][2]})[0] == 401,
                "rotation failed"))
            teams[0] = (teams[0][0], rotated_code, teams[0][2])

            # Login distinct devices in parallel; team 1 has rotated code.
            def login_one(args):
                code, device, colour = args
                return server.call("POST", "/api/login", {"code":code,"colour":colour,"device_id":device})
            mismatch = server.call("POST", "/api/login", {"code":teams[0][1],"colour":COLOURS[1],"device_id":"qa-wrong-colour"})
            record("selected team colour must match code identity", lambda: check(mismatch[0] == 401, "wrong colour registered against another identity"))
            logins = list(concurrent.futures.ThreadPoolExecutor(max_workers=target_teams).map(login_one, [(t[1],t[2],COLOURS[i]) for i,t in enumerate(teams)]))
            record("actual backend participant login", lambda: check(all(x[0] == 200 for x in logins), "login rejected"))
            slots = [server.call("POST", "/api/login", {"code":teams[0][1],"device_id":f"qa-device-extra-{i}"})[0] for i in range(2, 6)]
            too_many = server.call("POST", "/api/login", {"code":teams[0][1],"device_id":"qa-over-capacity"})
            record("member/device capacity enforced", lambda: check(all(code == 200 for code in slots) and too_many[0] == 403,
                                                                        "five-device boundary failed"))
            record("team isolation and registered-device requirement", lambda: check(
                server.call("GET", "/api/team/current", headers={"X-Team-Code":teams[1][1],"X-Device-ID":teams[0][2]})[0] == 401,
                "cross-team device accepted"))

            # Four fake level records for every test team; no production riddles/routes.
            envelope_codes = {}
            for idx, (team_id, _, _) in enumerate(teams):
                for level, station in enumerate("ABCD", 1):
                    envelope_code = new_code("E")
                    envelope_codes[(team_id, level)] = envelope_code
                    payload = {"station_id":station,"riddle_notes":f"TEST ONLY placeholder clue team {idx+1} level {level}",
                               "envelope_code":envelope_code}
                    code, _ = server.call("PUT", f"/api/admin/teams/{team_id}/levels/{level}", payload, admin=True)
                    check(code == 200, "route setup failed")
            record("four puzzle levels configured and private", lambda: check(
                "TEST ONLY" not in json.dumps(server.call("GET", "/api/team/current", headers={"X-Team-Code":teams[0][1],"X-Device-ID":teams[0][2]})[1]),
                "private organizer notes leaked"))
            record("start game and configure timer limits", lambda: check(
                server.call("PUT", "/api/admin/level-settings/1", {"duration_minutes":2}, admin=True)[0] == 200
                and server.call("POST", "/api/admin/game/start", admin=True)[0] == 200, "start/timer setting failed"))
            record("wrong envelope code does not advance", lambda: check(
                server.call("POST", "/api/submit", {"code":teams[0][1],"device_id":teams[0][2],"envelope_code":"INVALID-TEST-CODE"})[1].get("correct") is False,
                "incorrect code advanced"))
            record("expiry rejection and organizer time extension", lambda: check_timer_extension(server, db, teams[0], envelope_codes))
            record("four sequential envelope verifications", lambda: verify_levels(server, teams[0], envelope_codes))
            record("concurrent repeated envelope submissions advance exactly once", lambda: check_submission_race(server, teams[2], envelope_codes))
            record("back warning then elimination and reinstatement", lambda: check_violations(server, db, teams[1]))
            record("HttpOnly participant session, CSRF and timer-preserving reinstatement", lambda: check_participant_cookie_session(server, db, teams[3], envelope_codes))
            record("host progress/audit available, secrets excluded", lambda: inspect_overview(server, [t[1] for t in teams], list(envelope_codes.values())))
            record("pause, resume and finish transitions", lambda: check_game_transitions(server))

            # persistence across actual server restart using same disposable database
            server.stop()
            server = LocalServer(profile, db)
            code, overview = server.call("GET", "/api/admin/overview", admin=True)
            record("database persistence across backend restart", lambda: check(
                code == 200 and len(overview["teams"]) == target_teams and overview["game_state"]["status"] == "finished",
                "restart lost database state"))
            return results
        finally:
            server.stop()


def verify_levels(server, team, envelope_codes):
    tid, code, device = team
    for level in range(1, 5):
        state_code, state = server.call("GET", "/api/team/current", headers={"X-Team-Code":code,"X-Device-ID":device})
        check(state_code == 200 and state["progress"]["current_level"] == level, "wrong level sequence")
        sub_code, sub = server.call("POST", "/api/submit", {"code":code,"device_id":device,"envelope_code":envelope_codes[(tid, level)]})
        check(sub_code == 200 and sub.get("correct") is True, "envelope verification failed")
    final = server.call("POST", "/api/submit", {"code":code,"device_id":device,"envelope_code":envelope_codes[(tid, 4)]})
    check(final[0] == 409, "replay accepted after final completion")


def check_violations(server, db, team):
    import sqlite3
    _, code, device = team
    body = {"code":code,"device_id":device,"kind":"back_navigation"}
    first = server.call("POST", "/api/violation", body)[1]
    second = server.call("POST", "/api/violation", body)[1]
    check(first.get("warning") and second.get("eliminated"), "Back escalation failed")
    current = server.call("GET", "/api/team/current", headers={"X-Team-Code":code,"X-Device-ID":device})[1]
    check(current["eliminated"], "elimination not persisted")
    with sqlite3.connect(db) as conn:
        before = conn.execute("SELECT started_at,elapsed_seconds FROM team_levels WHERE team_id=? AND level=1", (team[0],)).fetchone()
    check(server.call("POST", f"/api/admin/team/{team[0]}/reinstate", admin=True)[0] == 200, "reinstate failed")
    with sqlite3.connect(db) as conn:
        after = conn.execute("SELECT started_at,elapsed_seconds FROM team_levels WHERE team_id=? AND level=1", (team[0],)).fetchone()
    check(before == after, "reinstatement changed stored timer state")
    exit_body = {"code":code,"device_id":device,"kind":"fullscreen_exit"}
    exited = server.call("POST", "/api/violation", exit_body)[1]
    current = server.call("GET", "/api/team/current", headers={"X-Team-Code":code,"X-Device-ID":device})[1]
    check(exited.get("eliminated") and current["eliminated"], "fullscreen-exit report did not eliminate team")
    check(server.call("POST", f"/api/admin/team/{team[0]}/reinstate", admin=True)[0] == 200, "fullscreen reinstatement failed")


def check_participant_cookie_session(server, db, team, envelope_codes):
    import sqlite3
    tid, code, device = team
    jar = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def call(method, path, body=None, headers=None):
        raw = None if body is None else json.dumps(body).encode()
        request_headers = {"Content-Type": "application/json"} if raw is not None else {}
        request_headers.update(headers or {})
        req = urllib.request.Request(server.base + path, data=raw, headers=request_headers, method=method)
        try:
            with client.open(req, timeout=10) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read() or b"{}")

    status, logged_in = call("POST", "/api/login", {"code":code,"device_id":device,"colour":COLOURS[3]})
    cookies = list(jar)
    check(status == 200 and logged_in.get("csrf_token") and "code" not in logged_in,
          "cookie participant login response exposed the credential or failed")
    check(any(cookie.name == "sh_participant_session" and cookie.has_nonstandard_attr("HttpOnly")
              and cookie._rest.get("SameSite") == "strict" for cookie in cookies),
          "participant session cookie missing HttpOnly/SameSite protections")
    session_status, restored = call("GET", "/api/team/session")
    check(session_status == 200 and restored["team"]["id"] == tid and "code" not in restored,
          "participant cookie session did not restore safely")
    current_status, current = call("GET", "/api/team/current")
    check(current_status == 200 and current["team"]["id"] == tid,
          "cookie-authenticated current state failed without code headers")
    bad_csrf, _ = call("POST", "/api/violation", {"kind":"fullscreen_exit"})
    check(bad_csrf == 403, "cookie-authenticated unsafe call did not require CSRF")
    with sqlite3.connect(db) as conn:
        before = conn.execute("SELECT started_at,elapsed_seconds FROM team_levels WHERE team_id=? AND level=1", (tid,)).fetchone()
    violation_status, violation_result = call("POST", "/api/violation", {"kind":"fullscreen_exit","details":"test-only browser exit"},
                                               {"X-Participant-CSRF":logged_in["csrf_token"]})
    check(violation_status == 200 and violation_result.get("eliminated"), "cookie-authenticated fullscreen violation failed")
    after_status, after_state = call("GET", "/api/team/current")
    check(after_status == 200 and after_state["eliminated"], "cookie session did not observe elimination")
    admin_status, _ = server.call("POST", f"/api/admin/team/{tid}/reinstate", admin=True)
    with sqlite3.connect(db) as conn:
        after = conn.execute("SELECT started_at,elapsed_seconds FROM team_levels WHERE team_id=? AND level=1", (tid,)).fetchone()
    check(admin_status == 200 and before == after, "reinstatement did not preserve the current timer")
    restored_status, restored_state = call("GET", "/api/team/current")
    check(restored_status == 200 and not restored_state["eliminated"], "participant did not observe organizer reinstatement")


def inspect_overview(server, login_codes, envelope_codes):
    code, overview = server.call("GET", "/api/admin/overview", admin=True)
    check(code == 200 and len(overview["events"]) > 0, "audit missing")
    text = json.dumps(overview)
    check(PASSWORD not in text and not any(value in text for value in login_codes + envelope_codes), "secret leaked")
    first_code, first = server.call("GET", "/api/admin/events?limit=1&offset=0", admin=True)
    second_code, second = server.call("GET", "/api/admin/events?limit=1&offset=1", admin=True)
    filtered_code, filtered = server.call("GET", "/api/admin/events?limit=25&kind=game_started", admin=True)
    check(first_code == 200 and second_code == 200 and first["total"] >= 2 and first["events"][0]["id"] != second["events"][0]["id"]
          and filtered_code == 200 and all(row["kind"] == "game_started" for row in filtered["events"]), "audit pagination/filter failed")


def check_host_sessions(server):
    # The suite's first browser jar is the first organizer. A second independent jar may join.
    second_jar = http.cookiejar.CookieJar()
    second = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(second_jar))
    body = json.dumps({"password": PASSWORD}).encode()
    req = urllib.request.Request(server.base + "/api/admin/login", data=body, headers={"Content-Type":"application/json"}, method="POST")
    with second.open(req, timeout=10) as response:
        result = json.loads(response.read())
        check(response.status == 200 and bool(result.get("csrf_token")), "second organizer login failed")
        cookie = next(iter(second_jar))
        check(cookie.has_nonstandard_attr("HttpOnly") and cookie._rest.get("SameSite", "").lower() == "strict", "host cookie flags missing")
    bad_csrf = server.call("POST", "/api/admin/game/pause", admin=True, headers={"X-CSRF-Token":"wrong"})
    check(bad_csrf[0] == 403, "missing/incorrect CSRF token accepted")
    third_jar = http.cookiejar.CookieJar()
    third = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(third_jar))
    req = urllib.request.Request(server.base + "/api/admin/login", data=body, headers={"Content-Type":"application/json"}, method="POST")
    try:
        with third.open(req, timeout=10) as response:
            code = response.status
    except urllib.error.HTTPError as exc:
        code = exc.code
    check(code == 429, "third organizer session was not limited")
    wrong = server.call("POST", "/api/admin/login", {"password":"incorrect-test-secret"})
    check(wrong[0] == 401, "incorrect organizer password accepted")


def check_game_transitions(server):
    check(server.call("POST", "/api/admin/game/pause", admin=True)[0] == 200, "pause failed")
    check(server.call("POST", "/api/admin/game/resume", admin=True)[0] == 200, "resume failed")
    check(server.call("POST", "/api/admin/game/finish", admin=True)[0] == 200, "finish failed")
    check(server.call("POST", "/api/admin/game/pause", admin=True)[0] == 409, "invalid pause transition accepted")


def check_submission_race(server, team, envelope_codes):
    tid, code, device = team
    def submit(_):
        return server.call("POST", "/api/submit", {"code":code,"device_id":device,"envelope_code":envelope_codes[(tid, 1)]})
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(submit, range(8)))
    check(sum(status == 200 and data.get("correct") is True for status, data in responses) == 1, "concurrent duplicate submission advanced more than once")
    state = server.call("GET", "/api/team/current", headers={"X-Team-Code":code,"X-Device-ID":device})[1]
    check(state["progress"]["completed_levels"] == 1, "concurrent submission progress is inconsistent")


def check_timer_extension(server, db, team, envelope_codes):
    import sqlite3
    # Move only this disposable fixture's start timestamp to exercise expiry without waiting.
    with sqlite3.connect(db) as conn:
        conn.execute("UPDATE team_levels SET started_at=datetime('now','-3 minutes') WHERE team_id=? AND level=1", (team[0],))
    headers = {"X-Team-Code":team[1],"X-Device-ID":team[2]}
    current = server.call("GET", "/api/team/current", headers=headers)[1]
    check(current["progress"]["current_level_timed_out"], "expired timer not reported")
    rejected = server.call("POST", "/api/submit", {"code":team[1],"device_id":team[2],"envelope_code":envelope_codes[(team[0], 1)]})
    check(rejected[0] == 403, "expired team submission accepted")
    check(server.call("PUT", "/api/admin/level-settings/1", {"duration_minutes":4}, admin=True)[0] == 200,
          "organizer extension failed")
    extended = server.call("GET", "/api/team/current", headers=headers)[1]
    check(not extended["progress"]["current_level_timed_out"], "increased time limit did not clear expiry")


def run_load_smoke():
    metrics = {}
    with tempfile.TemporaryDirectory(prefix="signal-hunt-load-qa-", ignore_cleanup_errors=True) as temp:
        server = LocalServer("demo", Path(temp) / "load.db")
        try:
            sessions = []
            for team_num, colour in enumerate(COLOURS):
                code = new_code("L")
                _, team = server.call("POST", "/api/admin/teams", {"name":f"Load Team {team_num+1}","colour":colour,
                                         "code":code,"team_size":5}, admin=True)
                for device_num in range(5):
                    device = f"load-device-{team_num:02d}-{device_num}"
                    jar = http.cookiejar.CookieJar()
                    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
                    req = urllib.request.Request(server.base + "/api/login", data=json.dumps({"code":code,"device_id":device}).encode(),
                                                 headers={"Content-Type":"application/json"}, method="POST")
                    with opener.open(req, timeout=15) as response:
                        login_data = json.loads(response.read())
                    check(login_data.get("csrf_token") and any(c.name == "sh_participant_session" for c in jar),
                          "load fixture cookie-session login failed")
                    sessions.append((opener, login_data["csrf_token"]))
            def ping(session):
                started = time.perf_counter()
                req = urllib.request.Request(server.base + "/api/team/current")
                try:
                    with session[0].open(req, timeout=15) as response:
                        response.read()
                        return response.status, (time.perf_counter() - started) * 1000
                except urllib.error.HTTPError as exc:
                    return exc.code, (time.perf_counter() - started) * 1000
            for clients in (10, 25, 50, 100):
                samples = [sessions[i % len(sessions)] for i in range(clients)]
                with concurrent.futures.ThreadPoolExecutor(max_workers=clients) as pool:
                    outcomes = list(pool.map(ping, samples))
                latencies = sorted(value for _, value in outcomes)
                errors = sum(code != 200 for code, _ in outcomes)
                metrics[str(clients)] = {"requests":clients,"errors":errors,"median_ms":round(statistics.median(latencies),2),
                                         "p95_ms":round(latencies[max(0,int(.95*len(latencies))-1)],2),"max_ms":round(max(latencies),2),
                                         "unique_registered_devices":len(sessions)}
                check(errors == 0, f"load errors at {clients} concurrent clients")
            # 52-client composition: the 50 permitted unique participant devices and two organizer sessions.
            second_jar = http.cookiejar.CookieJar()
            second_host = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(second_jar))
            login_request = urllib.request.Request(server.base + "/api/admin/login", data=json.dumps({"password":PASSWORD}).encode(),
                                                   headers={"Content-Type":"application/json"}, method="POST")
            with second_host.open(login_request, timeout=10) as response:
                second_csrf = json.loads(response.read())["csrf_token"]
            def host_ping(client):
                started = time.perf_counter()
                req = urllib.request.Request(server.base + "/api/admin/overview", headers={"X-CSRF-Token":client[1]})
                with client[0].open(req, timeout=15) as response:
                    response.read()
                    return response.status, (time.perf_counter() - started) * 1000
            def participant_ping(headers): return ping(headers)
            workload = [(participant_ping, session) for session in sessions]
            workload.extend([(host_ping, (server.opener, server.csrf)), (host_ping, (second_host, second_csrf))])
            started = time.perf_counter()
            with concurrent.futures.ThreadPoolExecutor(max_workers=52) as pool:
                outcomes = list(pool.map(lambda item: item[0](item[1]), workload))
            elapsed = (time.perf_counter() - started) * 1000
            errors = sum(code != 200 for code, _ in outcomes)
            metrics["52"] = {"requests":52,"errors":errors,"median_ms":round(statistics.median(v for _,v in outcomes),2),
                             "p95_ms":round(sorted(v for _,v in outcomes)[49],2),"max_ms":round(max(v for _,v in outcomes),2),
                             "unique_participant_devices":len(sessions),"organizer_sessions":2,"batch_ms":round(elapsed,2)}
            check(errors == 0, "mixed 52-session smoke failed")
        finally:
            server.stop()
    return metrics


if __name__ == "__main__":
    report = {}
    for profile, count in [("demo", 4), ("demo", 5), ("demo", 6), ("demo", 10), ("main", 10)]:
        key = f"{profile}-{count}-teams"
        report[key] = run_profile(profile, count)
        print(f"{key}: {len(report[key])} grouped checks passed")
    load = run_load_smoke()
    print("local concurrency smoke: " + json.dumps(load))
    print(json.dumps({"grouped_checks":sum(map(len, report.values())),"suites":report,"load":load}, indent=2))
