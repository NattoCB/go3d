"""Browser-backed session must preserve the local API's game semantics."""
import unittest

from web_api import BrowserAPI


class BrowserAPITests(unittest.TestCase):
    def setUp(self):
        self.api = BrowserAPI()

    def test_play_undo_export_and_import(self):
        status, state = self.api.dispatch('/api/state')
        self.assertEqual(status, 200)
        self.assertEqual(state['game']['move_number'], 0)
        status, state = self.api.dispatch('/api/action', {'action': 'move', 'revision': state['revision'], 'point': [0, 0, 0]})
        self.assertEqual(status, 200)
        self.assertEqual(state['game']['move_number'], 1)
        _, save = self.api.dispatch('/api/export')
        _, after_undo = self.api.dispatch('/api/action', {'action': 'undo', 'revision': state['revision']})
        self.assertEqual(after_undo['game']['move_number'], 0)
        status, restored = self.api.dispatch('/api/import', {'revision': after_undo['revision'], 'data': save})
        self.assertEqual(status, 200)
        self.assertEqual(restored['game']['move_number'], 1)

    def test_stale_revision_returns_current_state_without_mutating(self):
        _, first = self.api.dispatch('/api/action', {'action': 'move', 'revision': 0, 'point': [0, 0, 0]})
        status, result = self.api.dispatch('/api/action', {'action': 'move', 'revision': 0, 'point': [1, 0, 0]})
        self.assertEqual(status, 409)
        self.assertEqual(result['state']['revision'], first['revision'])
        self.assertEqual(result['state']['game']['move_number'], 1)

    def test_invalid_save_preserves_current_game(self):
        status, result = self.api.dispatch('/api/import', {'revision': 0, 'data': {}})
        self.assertEqual(status, 400)
        self.assertEqual(result['state']['game']['move_number'], 0)
