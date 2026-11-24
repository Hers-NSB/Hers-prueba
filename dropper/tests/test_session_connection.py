from types import SimpleNamespace
import unittest
from unittest.mock import Mock


class SessionButtonTests(unittest.TestCase):
    def test_desktop_has_no_login_workflow(self):
        from desktop import BotPanel
        self.assertFalse(hasattr(BotPanel, 'connect_recording'))

    def test_bot_starts_without_local_session_file(self):
        from desktop import BotPanel
        panel=BotPanel.__new__(BotPanel)
        panel.controller=SimpleNamespace(running=False,start=Mock())
        panel.manager=SimpleNamespace(closing=False,panels={},client=Mock(),auth_required=False)
        panel.set_mode=Mock()
        panel.active_elsewhere=False
        panel.start()
        panel.controller.start.assert_called_once()


if __name__=='__main__':
    unittest.main()
