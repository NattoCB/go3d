"""Behavior fixtures derived on a three-dimensional orthogonal graph."""

import copy
import importlib
import itertools
import json
import unittest


def adjacent(point, size=3):
    result = []
    for axis in range(3):
        for step in (-1, 1):
            candidate = list(point)
            candidate[axis] += step
            if 0 <= candidate[axis] < size:
                result.append(tuple(candidate))
    return result


def ko_setup():
    # White corner has the vacant (1,0,0) as its only liberty. The black
    # capture there will in turn have the vacated corner as its only liberty.
    return {(0, 0, 0): 2, (0, 1, 0): 1, (0, 0, 1): 1,
            (2, 0, 0): 2, (1, 1, 0): 2, (1, 0, 1): 2}


class EngineTests(unittest.TestCase):
    def setUp(self):
        try:
            module = importlib.import_module("engine")
        except ModuleNotFoundError:
            self.fail("The three-dimensional rule engine is not implemented yet")
        self.Game = module.Game
        self.IllegalMove = module.IllegalMove

    def test_default_board_and_allowed_sizes(self):
        self.assertEqual(len(self.Game().to_dict()["board"]), 125)
        for size in (3, 5, 7):
            with self.subTest(size=size):
                self.assertEqual(len(self.Game(size=size).to_dict()["board"]), size ** 3)

    def test_center_has_six_and_corner_three_orthogonal_neighbors(self):
        game = self.Game(size=3)
        self.assertEqual(set(game.neighbors((1, 1, 1))), {
            (0, 1, 1), (2, 1, 1), (1, 0, 1),
            (1, 2, 1), (1, 1, 0), (1, 1, 2),
        })
        self.assertEqual(set(game.neighbors((0, 0, 0))), {
            (1, 0, 0), (0, 1, 0), (0, 0, 1),
        })

    def test_flat_board_x_fastest_then_y_then_z(self):
        for point, index in [((1, 0, 0), 1), ((0, 1, 0), 3), ((0, 0, 1), 9)]:
            with self.subTest(point=point):
                board = self.Game(size=3, setup={point: 1}).to_dict()["board"]
                self.assertEqual(board[index], 1)
                self.assertEqual(sum(board), 1)

    def test_l_shaped_group_has_seven_unique_liberties(self):
        setup = {(0, 0, 0): 1, (1, 0, 0): 1, (1, 1, 0): 1}
        game = self.Game(size=3, setup=setup)
        stones, liberties = game.group((0, 0, 0))
        self.assertEqual(stones, set(setup))
        self.assertEqual(liberties, {(0, 1, 0), (0, 0, 1), (2, 0, 0),
                                    (1, 0, 1), (2, 1, 0), (1, 2, 0), (1, 1, 1)})
        self.assertEqual(game.group((2, 2, 2)), (set(), set()))

    def test_cross_z_connected_block_is_captured_together(self):
        victims = {(1, 1, 1), (1, 1, 2)}
        last_liberty = (1, 2, 2)
        setup = {p: 1 for v in victims for p in adjacent(v)
                 if p not in victims and p != last_liberty}
        setup.update({p: 2 for p in victims})
        game = self.Game(size=3, setup=setup)
        self.assertEqual(game.group((1, 1, 1)), (victims, {last_liberty}))
        self.assertEqual(set(game.play(last_liberty)), victims)
        self.assertEqual(game.to_dict()["captures"], {"black": 2, "white": 0})
        self.assertEqual(game.group((1, 1, 1)), (set(), set()))

    def test_suicide_is_atomic(self):
        game = self.Game(size=3, setup={(1, 0, 0): 2, (0, 1, 0): 2, (0, 0, 1): 2})
        before = game.to_dict()
        with self.assertRaises(self.IllegalMove):
            game.play((0, 0, 0))
        self.assertEqual(game.to_dict(), before)
        self.assertFalse(game.undo())

    def test_enemy_capture_precedes_self_liberty_check(self):
        game = self.Game(size=3, setup={
            (1, 0, 0): 2, (0, 1, 0): 2, (0, 0, 1): 2,
            (2, 0, 0): 1, (1, 1, 0): 1, (1, 0, 1): 1,
        })
        self.assertEqual(game.play((0, 0, 0)), [(1, 0, 0)])
        self.assertEqual(game.group((0, 0, 0))[1], {(1, 0, 0)})

    def test_diagonal_stones_are_not_connected(self):
        game = self.Game(size=3, setup={(0, 0, 0): 1, (1, 1, 0): 1, (0, 1, 1): 1})
        self.assertEqual(game.group((0, 0, 0))[0], {(0, 0, 0)})

    def test_occupied_and_malformed_moves_leave_state_unchanged(self):
        game = self.Game(size=3, setup={(0, 0, 0): 1})
        before = game.to_dict()
        for point in [(0, 0, 0), (-1, 0, 0), (3, 0, 0), (True, 0, 0),
                      (0.0, 0, 0), (0, 0), (0, 0, 0, 0), "000", None]:
            with self.subTest(point=point), self.assertRaises(self.IllegalMove):
                game.play(point)
            self.assertEqual(game.to_dict(), before)

    def test_immediate_ko_and_recapture_after_pass_resume_are_forbidden(self):
        game = self.Game(size=3, setup=ko_setup())
        self.assertEqual(game.play((1, 0, 0)), [(0, 0, 0)])
        before = game.to_dict()
        with self.assertRaises(self.IllegalMove):
            game.play((0, 0, 0))
        self.assertEqual(game.to_dict(), before)
        game.pass_turn()
        game.pass_turn()
        game.resume()
        with self.assertRaises(self.IllegalMove):
            game.play((0, 0, 0))

    def test_superko_remembers_a_distant_three_ko_cycle(self):
        corners = [(0, 0, 0), (0, 6, 0), (6, 6, 6)]
        vacancies = [(1, 0, 0), (1, 6, 0), (5, 6, 6)]
        setup = {}
        for corner, vacancy, color in zip(corners, vacancies, (2, 1, 2)):
            setup[corner] = color
            setup.update({p: 3 - color for p in adjacent(corner, 7) if p != vacancy})
            setup.update({p: color for p in adjacent(vacancy, 7) if p != corner})
        game = self.Game(size=7, setup=setup)
        for point in [vacancies[0], vacancies[1], vacancies[2], corners[0], corners[1]]:
            game.play(point)
        before = game.to_dict()
        with self.assertRaises(self.IllegalMove):
            game.play(corners[2])
        self.assertEqual(game.to_dict(), before)

    def test_capture_undo_restores_all_state_and_allows_replaying_move(self):
        game = self.Game(size=3, setup=ko_setup())
        before = game.to_dict()
        game.play((1, 0, 0))
        self.assertTrue(game.undo())
        self.assertEqual(game.to_dict(), before)
        self.assertEqual(game.play((1, 0, 0)), [(0, 0, 0)])

    def test_passes_finish_game_and_undo_reopens_it(self):
        game = self.Game(size=3)
        game.pass_turn()
        self.assertFalse(game.finished)
        game.pass_turn()
        self.assertTrue(game.finished)
        for operation in [lambda: game.play((0, 0, 0)), game.pass_turn, game.resign]:
            with self.assertRaises(self.IllegalMove):
                operation()
        self.assertTrue(game.undo())
        self.assertFalse(game.finished)
        self.assertEqual(game.pass_count, 1)

    def test_move_resets_consecutive_pass_count(self):
        game = self.Game(size=3)
        game.pass_turn()
        game.play((0, 0, 0))
        game.pass_turn()
        self.assertFalse(game.finished)
        self.assertEqual(game.pass_count, 1)

    def test_area_score_flood_fills_all_three_axes(self):
        empty = self.Game(size=3).to_dict()["score"]
        self.assertEqual((empty["black"], empty["white"], empty["neutral"]), (0, 0.5, 27))
        single = self.Game(size=3, setup={(0, 0, 0): 1}).to_dict()["score"]
        self.assertEqual((single["black"], single["black_stones"], single["black_territory"]), (27, 1, 26))
        mixed = self.Game(size=3, setup={(0, 0, 0): 1, (2, 2, 2): 2}).to_dict()["score"]
        self.assertEqual((mixed["black"], mixed["white"], mixed["neutral"]), (1, 1.5, 25))
        self.assertEqual(len(mixed["territory"]), 27)

    def test_dead_marking_selects_entire_cross_layer_group(self):
        stones = {(0, 0, 0), (0, 0, 1)}
        game = self.Game(size=3, setup={p: 1 for p in stones})
        with self.assertRaises(self.IllegalMove):
            game.toggle_dead((0, 0, 0))
        game.pass_turn()
        game.pass_turn()
        game.toggle_dead((0, 0, 0))
        self.assertEqual({tuple(p) for p in game.to_dict()["dead"]}, stones)
        self.assertEqual(game.to_dict()["score"]["neutral"], 27)
        game.toggle_dead((0, 0, 1))
        self.assertEqual(game.to_dict()["dead"], [])
        with self.assertRaises(self.IllegalMove):
            game.toggle_dead((2, 2, 2))

    def test_resume_clears_dead_marks_and_undo_restores_scoring_phase(self):
        game = self.Game(size=3, setup={(0, 0, 0): 1})
        game.pass_turn()
        game.pass_turn()
        game.toggle_dead((0, 0, 0))
        before = game.to_dict()
        game.resume()
        self.assertFalse(game.finished)
        self.assertEqual((game.pass_count, game.to_dict()["dead"]), (0, []))
        self.assertTrue(game.undo())
        self.assertEqual(game.to_dict(), before)

    def test_resign_records_color_and_forbids_resume_and_dead_selection(self):
        game = self.Game(size=3, turn=2)
        before = game.to_dict()
        game.resign()
        self.assertTrue(game.finished)
        self.assertEqual(game.resigned, 2)
        for operation in [game.resume, lambda: game.toggle_dead((0, 0, 0))]:
            with self.assertRaises(self.IllegalMove):
                operation()
        game.undo()
        self.assertEqual(game.to_dict(), before)

    def test_constructor_rejects_bad_types_sizes_komi_and_dead_setup_groups(self):
        invalid = [dict(size=True), dict(size=2), dict(size=4), dict(size=6), dict(size=8),
                   dict(size=5.0), dict(komi=True), dict(komi=float("nan")),
                   dict(komi=float("inf")), dict(komi=51), dict(komi=10 ** 1000),
                   dict(turn=True), dict(turn=0), dict(setup=[]),
                   dict(setup={(0, 0, 0): True}), dict(setup={(0, 0, 0): 0}),
                   dict(size=3, setup={(3, 0, 0): 1}),
                   dict(setup={(0, 0, 0, 0): 1}),
                   dict(size=3, setup={(0, 0, 0): 1, (1, 0, 0): 2, (0, 1, 0): 2, (0, 0, 1): 2})]
        for kwargs in invalid:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.Game(**kwargs)

    def test_save_roundtrip_preserves_state_and_full_undo_history(self):
        game = self.Game(size=3, setup=ko_setup(), komi=-2)
        game.play((1, 0, 0))
        game.pass_turn()
        game.pass_turn()
        game.toggle_dead((2, 0, 0))
        data = json.loads(json.dumps(game.export_data()))
        self.assertEqual(data["format"], "go3d")
        restored = self.Game.from_data(data)
        self.assertEqual(restored.to_dict(), game.to_dict())
        while game.undo():
            self.assertTrue(restored.undo())
            self.assertEqual(restored.to_dict(), game.to_dict())
        self.assertFalse(restored.undo())

    def test_import_preserves_dead_annotation_before_resumed_action(self):
        game = self.Game(size=3, setup={(0, 0, 0): 1})
        game.pass_turn()
        game.pass_turn()
        game.toggle_dead((0, 0, 0))
        before = game.to_dict()
        game.resume()
        restored = self.Game.from_data(game.export_data())
        self.assertTrue(restored.undo())
        self.assertEqual(restored.to_dict(), before)

    def test_undone_action_disappears_from_export(self):
        game = self.Game(size=3)
        game.play((0, 0, 0))
        game.play((2, 2, 2))
        game.undo()
        data = game.export_data()
        self.assertEqual(len(data["moves"]), 1)
        self.assertEqual(self.Game.from_data(data).to_dict(), game.to_dict())

    def test_save_rejects_malformed_fields_and_illegal_moves(self):
        valid = self.Game(size=3).export_data()
        invalid = [None, [], {}, {**valid, "format": "go4d"}, {**valid, "size": True},
                   {**valid, "size": 4}, {**valid, "version": True}, {**valid, "komi": "0.5"},
                   {**valid, "komi": float("nan")}, {**valid, "turn": 0},
                   {**valid, "unknown": 1}, {**valid, "moves": [None]},
                   {**valid, "moves": [{"color": 2, "action": "pass", "point": None}]},
                   {**valid, "moves": [{"color": True, "action": "move", "point": [0, 0, 0]}]},
                   {**valid, "moves": [{"color": 1, "action": "move", "point": [True, 0, 0]}]},
                   {**valid, "moves": [{"color": 1, "action": "move", "point": [0, 0, 0, 0]}]},
                   {**valid, "moves": [{"color": 1, "action": "move", "point": (0, 0, 0)}]},
                   {**valid, "moves": [{"color": 1, "action": "pass", "point": [0, 0, 0]}]},
                   {**valid, "dead": [[0, 0, 0]]},
                   {**valid, "setup": [{"color": 1, "point": [0, 0, 0]}, {"color": 2, "point": [0, 0, 0]}]},
                   {**valid, "setup": [{"color": 1, "point": (0, 0, 0)}]},
                   {**valid, "moves": [{"color": 1, "action": "pass", "point": None}] * 3001}]
        duplicate = copy.deepcopy(valid)
        duplicate["moves"] = [{"color": 1, "action": "move", "point": [0, 0, 0]},
                              {"color": 2, "action": "move", "point": [0, 0, 0]}]
        invalid.append(duplicate)
        for data in invalid:
            if type(data) is dict and type(data.get("moves")) is list:
                data["dead_history"] = [[] for _ in data["moves"]]
            with self.subTest(data=str(data)[:120]), self.assertRaises(ValueError):
                self.Game.from_data(data)

    def test_dead_save_rejects_partial_groups_duplicates_and_wrong_types(self):
        game = self.Game(size=3, setup={(0, 0, 0): 1, (0, 0, 1): 1})
        game.pass_turn()
        game.pass_turn()
        data = game.export_data()
        for marks in [[[0, 0, 0]], [[0, 0, 0], [0, 0, 1], [0, 0, 0]],
                      [(0, 0, 0), (0, 0, 1)], [[0, 0, 0], [0, 0, 1], [2, 2, 2]]]:
            invalid = {**data, "dead": marks}
            with self.subTest(marks=marks), self.assertRaises(ValueError):
                self.Game.from_data(invalid)

    def test_dead_history_and_superko_replay_are_validated(self):
        game = self.Game(size=3, setup=ko_setup())
        game.play((1, 0, 0))
        valid = game.export_data()
        recapture = copy.deepcopy(valid)
        recapture["moves"].append({"color": 2, "action": "move", "point": [0, 0, 0]})
        recapture["dead_history"].append([])
        wrong_count = {**valid, "dead_history": []}
        active_marks = {**valid, "dead_history": [[[0, 0, 0]]]}
        for data in [recapture, wrong_count, active_marks]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                self.Game.from_data(data)

    def test_turn_action_capacity_is_atomic_at_3000_actions(self):
        game = self.Game(size=3)
        for _ in range(1000):
            game.pass_turn()
            game.pass_turn()
            game.resume()
        before = game.to_dict()
        for operation in [lambda: game.play((0, 0, 0)), game.pass_turn, game.resign]:
            with self.assertRaises(self.IllegalMove):
                operation()
            self.assertEqual(game.to_dict(), before)
        self.assertEqual(len(self.Game.from_data(game.export_data()).moves), 3000)

    def test_large_connected_dead_history_preserves_replay_and_undo(self):
        holes = {(0, 0, 0), (6, 6, 6)}
        setup = {point: 1 for point in itertools.product(range(7), repeat=3) if point not in holes}
        game = self.Game(size=7, setup=setup)
        for _ in range(150):
            game.pass_turn()
            game.pass_turn()
            game.toggle_dead((1, 0, 0))
            game.resume()
        data = game.export_data()
        restored = self.Game.from_data(data)
        self.assertEqual(restored.to_dict(), game.to_dict())
        self.assertTrue(restored.undo())
        self.assertTrue(restored.finished)
        self.assertEqual(len(restored.to_dict()["dead"]), 341)
        self.assertEqual(restored.to_dict()["score"]["neutral"], 343)
        self.assertEqual(restored.to_dict()["score"]["black"], 0)


if __name__ == "__main__":
    unittest.main()
