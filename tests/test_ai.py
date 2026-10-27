import importlib
import itertools
import unittest

from test_engine import ko_setup


class AITests(unittest.TestCase):
    def setUp(self):
        try:
            self.Game = importlib.import_module("engine").Game
            self.choose_move = importlib.import_module("ai").choose_move
        except ModuleNotFoundError:
            self.fail("The three-dimensional legal AI is not implemented yet")

    def test_seeded_opening_is_legal_repeatable_and_has_no_side_effects(self):
        game = self.Game(size=7)
        before = game.to_dict()
        move = self.choose_move(game, seed=42)
        self.assertIsNotNone(move)
        self.assertEqual(move, self.choose_move(game, seed=42))
        self.assertEqual(game.to_dict(), before)
        game.play(move)

    def test_capture_is_prioritized(self):
        game = self.Game(size=3, setup=ko_setup())
        before = game.to_dict()
        self.assertEqual(self.choose_move(game, seed=3), (1, 0, 0))
        self.assertEqual(game.to_dict(), before)

    def test_ai_rescues_own_corner_group_from_atari(self):
        game = self.Game(size=3, setup={(0, 0, 0): 1, (0, 1, 0): 2, (0, 0, 1): 2})
        self.assertEqual(self.choose_move(game, seed=7), (1, 0, 0))

    def test_ai_does_not_return_superko_recapture(self):
        game = self.Game(size=3, setup=ko_setup())
        game.play((1, 0, 0))
        move = self.choose_move(game, seed=5)
        self.assertNotEqual(move, (0, 0, 0))
        if move is not None:
            game.play(move)

    def test_ai_passes_when_only_own_eyes_are_empty(self):
        eyes = {(0, 0, 0), (2, 2, 2)}
        setup = {p: 1 for p in itertools.product(range(3), repeat=3) if p not in eyes}
        game = self.Game(size=3, setup=setup)
        before = game.to_dict()
        self.assertIsNone(self.choose_move(game, seed=0))
        self.assertEqual(game.to_dict(), before)

    def test_ai_avoids_filling_own_eye_with_other_moves_available(self):
        game = self.Game(size=3, setup={(1, 0, 0): 1, (0, 1, 0): 1, (0, 0, 1): 1})
        for seed in range(5):
            with self.subTest(seed=seed):
                move = self.choose_move(game, seed=seed)
                self.assertIsNotNone(move)
                self.assertNotEqual(move, (0, 0, 0))

    def test_finished_game_has_no_ai_move(self):
        game = self.Game(size=3)
        game.pass_turn()
        game.pass_turn()
        self.assertIsNone(self.choose_move(game, seed=2))

    def test_returned_moves_are_legal_over_a_whole_game(self):
        game = self.Game(size=3)
        for number in range(80):
            before = game.to_dict()
            move = self.choose_move(game, seed=number)
            self.assertEqual(game.to_dict(), before)
            if move is None:
                game.pass_turn()
            else:
                game.play(move)
            if game.finished:
                break


if __name__ == "__main__":
    unittest.main()
