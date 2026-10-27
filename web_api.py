"""Dispatch browser-local requests to the same game session as the server."""
from session import GameSession, RequestError


class BrowserAPI:
    """Own one in-memory game session and return status/data pairs."""

    def __init__(self):
        self.session = GameSession()

    def dispatch(self, path, data=None):
        try:
            if path == '/api/state':
                return 200, self.session.state()
            if path == '/api/export':
                return 200, self.session.export()
            if path == '/api/action':
                return 200, self.session.action(data)
            if path == '/api/import':
                return 200, self.session.import_save(data)
            raise RequestError('接口不存在。', 404)
        except (RequestError, ValueError) as exc:
            return getattr(exc, 'status', 400), {'error': str(exc), 'state': self.session.state()}
