"""Real HTTP requests protect the three-dimensional game boundary."""

import http.client
import importlib.util
import json
import threading
import unittest


class HTTPGameTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec("app"), "3D HTTP game is not implemented")
        from app import make_server
        self.server = make_server(0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, method, path, data=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        body = json.dumps(data).encode() if data is not None else None
        request_headers = {"Content-Type": "application/json"} if body is not None else {}
        request_headers.update(headers or {})
        connection.request(method, path, body=body, headers=request_headers)
        response = connection.getresponse()
        raw = response.read()
        status, kind = response.status, response.getheader("Content-Type", "")
        connection.close()
        return status, json.loads(raw) if "application/json" in kind else raw, kind

    def action(self, action, revision, **kwargs):
        return self.request("POST", "/api/action", {"action": action, "revision": revision, **kwargs})[:2]

    def test_default_cube_moves_read_back_and_undo(self):
        status, before, _ = self.request("GET", "/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(before["game"]["size"], 5)
        self.assertEqual(len(before["game"]["board"]), 125)
        status, after = self.action("move", 0, point=[0, 0, 0])
        self.assertEqual(status, 200)
        self.assertEqual(after["game"]["board"][0], 1)
        self.assertEqual(after["game"]["turn"], 2)
        self.assertEqual(self.request("GET", "/api/state")[1], after)
        _, restored = self.action("undo", after["revision"])
        self.assertEqual(restored["game"]["board"], before["game"]["board"])

    def test_demo_capture_is_through_z_neighbor(self):
        _, demo = self.action("demo", 0)
        self.assertEqual((demo["game"]["size"], demo["game"]["board"][13]), (3, 2))
        status, captured = self.action("move", demo["revision"], point=[1, 1, 2])
        self.assertEqual(status, 200)
        self.assertEqual(captured["game"]["last_captured"], [[1, 1, 1]])
        self.assertEqual(captured["game"]["board"][13], 0)
        self.assertEqual(captured["game"]["captures"]["black"], 1)

    def test_stale_revision_cannot_overwrite_position(self):
        _, after = self.action("move", 0, point=[0, 0, 0])
        status, error = self.action("move", 0, point=[1, 0, 0])
        self.assertEqual(status, 409)
        self.assertEqual(error["state"], after)

    def test_occupied_or_four_coordinate_moves_are_atomic(self):
        _, before = self.action("move", 0, point=[0, 0, 0])
        for point in ([0, 0, 0], [1, 0, 0, 0], [True, 0, 0], [5, 0, 0]):
            status, error = self.action("move", before["revision"], point=point)
            self.assertEqual(status, 400)
            self.assertEqual(error["state"], before)

    def test_save_import_preserves_three_coordinate_replay_and_undo(self):
        self.action("move", 0, point=[0, 0, 0])
        _, saved, _ = self.request("GET", "/api/export")
        self.assertEqual(saved["format"], "go3d-session-v1")
        _, fresh = self.action("new", 1, size=7, mode="local", komi=1.5)
        status, loaded, _ = self.request("POST", "/api/import", {"revision": fresh["revision"], "data": saved})
        self.assertEqual(status, 200)
        self.assertEqual(loaded["game"]["size"], 5)
        self.assertEqual(loaded["game"]["board"][0], 1)
        _, undone = self.action("undo", loaded["revision"])
        self.assertEqual(sum(undone["game"]["board"]), 0)

    def test_ai_replies_and_undo_returns_black_turn(self):
        _, fresh = self.action("new", 0, size=7, mode="ai", komi=0.5)
        status, played = self.action("move", fresh["revision"], point=[3, 3, 3])
        self.assertEqual(status, 200)
        self.assertEqual((played["game"]["move_number"], played["game"]["turn"]), (2, 1))
        _, restored = self.action("undo", played["revision"])
        self.assertEqual((restored["game"]["move_number"], sum(restored["game"]["board"])), (0, 0))

    def test_hint_is_legal_and_does_not_mutate_game(self):
        _, before, _ = self.request("GET", "/api/state")
        status, hinted = self.action("hint", 0)
        self.assertEqual(status, 200)
        self.assertEqual(len(hinted["hint"]), 3)
        self.assertEqual(self.request("GET", "/api/state")[1], before)
        self.assertEqual(self.action("move", 0, point=hinted["hint"])[0], 200)

    def test_two_passes_dead_overlay_and_resume(self):
        _, moved = self.action("move", 0, point=[0, 0, 0])
        _, first = self.action("pass", moved["revision"])
        _, scored = self.action("pass", first["revision"])
        self.assertTrue(scored["game"]["finished"])
        _, dead = self.action("dead", scored["revision"], point=[0, 0, 0])
        self.assertEqual(dead["game"]["dead"], [[0, 0, 0]])
        self.assertEqual(dead["game"]["board"][0], 1)
        self.assertEqual(dead["game"]["score"]["neutral"], 125)
        _, resumed = self.action("resume", dead["revision"])
        self.assertFalse(resumed["game"]["finished"])
        self.assertEqual(resumed["game"]["dead"], [])

    def test_bad_new_and_four_dimensional_saves_preserve_state(self):
        _, before, _ = self.request("GET", "/api/state")
        for fields in ({"size": True}, {"size": 4}, {"komi": float("nan")}, {"mode": "online"}):
            status, error = self.action("new", 0, **fields)
            self.assertEqual(status, 400)
            self.assertEqual(error["state"], before)
        status, error, _ = self.request("POST", "/api/import", {"revision": 0, "data": {"format": "go4d-session-v1"}})
        self.assertEqual(status, 400)
        self.assertEqual(error["state"], before)

    def test_foreign_origin_host_and_non_json_are_rejected(self):
        data = {"action": "pass", "revision": 0}
        self.assertEqual(self.request("POST", "/api/action", data, {"Origin": "https://elsewhere.example"})[0], 403)
        self.assertEqual(self.request("GET", "/api/state", headers={"Host": "elsewhere.example"})[0], 403)
        self.assertEqual(self.request("POST", "/api/action", data, {"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("POST", "/api/action", ["pass"])[0], 400)
        self.assertEqual(self.request("GET", "/api/state")[1]["revision"], 0)

    def test_three_modules_have_browser_javascript_mime(self):
        for path in ("/vendor/three.module.js", "/vendor/three.core.js", "/vendor/OrbitControls.js"):
            status, body, kind = self.request("GET", path)
            self.assertEqual(status, 200)
            self.assertTrue(body)
            self.assertIn("javascript", kind)
        self.assertEqual(self.request("GET", "/engine.py")[0], 404)
        self.assertEqual(self.request("GET", "/../engine.py")[0], 404)

    def test_ai_action_budget_reserves_whole_round(self):
        session = self.server.session
        for _ in range(999):
            session.game.pass_turn()
            session.game.pass_turn()
            session.game.resume()
        session.game.play((0, 0, 0))
        session.game.play((4, 4, 4))
        session.mode = "ai"
        before = session.state()
        status, error = self.action("move", 0, point=[2, 2, 2])
        self.assertEqual(status, 400)
        self.assertEqual(error["state"], before)

    def test_imported_white_start_preserves_initial_ai_move_on_undo(self):
        from engine import Game, WHITE
        saved = {"format": "go3d-session-v1", "mode": "ai", "game": Game(turn=WHITE).export_data()}
        status, opened, _ = self.request("POST", "/api/import", {"revision": 0, "data": saved})
        self.assertEqual(status, 200)
        self.assertEqual(opened["game"]["turn"], 1)
        status, rejected = self.action("undo", opened["revision"])
        self.assertEqual(status, 400)
        self.assertEqual(rejected["state"], opened)


if __name__ == "__main__":
    unittest.main()
