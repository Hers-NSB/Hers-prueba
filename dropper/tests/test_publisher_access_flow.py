import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch

from cloud_client import AccessDenied
from desktop import DropperWindow


class AccessFlowTests(unittest.TestCase):
    def manager(self):
        manager = DropperWindow.__new__(DropperWindow)
        manager.vault = Mock()
        manager.status = Mock()
        manager.show_loading = Mock()
        manager.hide_loading = Mock()
        manager.connect_dialog = Mock()
        manager.auth_required = False
        manager.checking_updates = False
        manager.profile_snapshot = {}
        manager.profile_cache = None
        manager.update_hint = Mock()
        manager.connecting = manager.refreshing = manager.closing = False
        return manager

    def test_first_launch_waits_for_manual_update(self):
        manager = self.manager()
        manager.vault.read.return_value = None
        manager.try_connect = Mock()
        manager.auto_connect()
        manager.connect_dialog.assert_not_called()
        manager.try_connect.assert_not_called()

    def test_revoked_password_clears_saved_access_and_requests_new_password(self):
        manager = self.manager()
        panel = SimpleNamespace(stop=Mock())
        manager.panels = {'first': panel}
        manager.cloud_failed(AccessDenied('Contraseña cambiada'))
        self.assertTrue(manager.auth_required)
        manager.vault.delete.assert_called_once()
        manager.connect_dialog.assert_called_once()
        panel.stop.assert_not_called()

    def test_update_asks_for_new_password_when_revoked(self):
        manager = self.manager()
        manager.client = Mock()
        manager.auth_required = True
        manager.refresh()
        manager.connect_dialog.assert_called_once()
        manager.client.list_profiles.assert_not_called()

    def test_idle_check_only_requests_revisions_and_shows_notice(self):
        manager = self.manager()
        manager.panels = {'one': SimpleNamespace(mode='stopped', controller=SimpleNamespace(running=False))}
        manager.client = Mock()
        manager.client.profile_revisions.return_value = [{'id': 'one', 'revision': 2}]
        manager.profile_snapshot = {'one': (1, None)}
        manager.apply_profiles = Mock()
        manager.background = lambda work, complete, failed: complete(work())
        manager.check_updates()
        manager.client.profile_revisions.assert_called_once_with()
        manager.client.report_bot_activity.assert_not_called()
        manager.client.list_profiles.assert_not_called()
        manager.apply_profiles.assert_not_called()
        manager.update_hint.set.assert_called_once_with('Hay cambios disponibles')

    def test_active_profile_revision_change_refreshes_configuration(self):
        manager = self.manager()
        manager.panels = {'one': SimpleNamespace(mode='running', controller=SimpleNamespace(running=True))}
        manager.client = Mock()
        manager.client.profile_revisions.return_value = [{'id': 'one', 'revision': 2}]
        manager.profile_snapshot = {'one': (1, None)}
        manager.refresh = Mock()
        manager.background = lambda work, complete, failed: complete(work())
        manager.check_updates()
        manager.refresh.assert_called_once_with()
        manager.client.report_bot_activity.assert_called_once_with([{'id': 'one', 'revision': 1}])

    def test_saved_password_does_not_download_profiles_on_launch(self):
        manager = self.manager()
        manager.vault.read.return_value = 'saved-password'
        with patch('desktop.CloudClient') as client:
            manager.auto_connect()
        client.assert_called_once_with('saved-password')
        manager.client.list_profiles.assert_not_called()

    def test_manual_download_persists_metadata_and_restores_it_without_a_request(self):
        manager = self.manager()
        manager.apply_profiles = Mock()
        profile = {'id': 'one', 'name': 'Luna', 'bot_id': '123', 'revision': 1, 'updated_at': None,
                   'creator': {'external_id': 42, 'name': 'Luna', 'username': 'luna'},
                   'telegram_token': 'private-token', 'api_key': 'private-key'}
        with TemporaryDirectory() as directory:
            manager.profile_cache = Path(directory) / 'profiles.json'
            manager.save_profiles([profile])
            self.assertNotIn('private-', manager.profile_cache.read_text())
            manager.apply_profiles.reset_mock()
            manager.restore_profiles()
            restored = manager.apply_profiles.call_args.args[0][0]
            self.assertEqual(restored['creator'], profile['creator'])
            self.assertEqual(manager.profile_snapshot, {'one': (1, None)})

    def login_manager(self):
        manager = self.manager()
        manager.root = Mock()
        manager.connected = Mock()
        manager.apply_profiles = Mock()
        manager.access_dialog = Mock()
        manager.access_dialog.winfo_exists.return_value = True
        manager.background = lambda work, complete, failed: complete([{'id': 'one', 'revision': 1}])
        return manager

    def test_successful_login_closes_stored_password_window_without_dialog_argument(self):
        manager = self.login_manager()
        dialog = manager.access_dialog
        with patch('desktop.CloudClient'):
            manager.try_connect('password')
        manager.apply_profiles.assert_called_once_with([{'id': 'one', 'revision': 1}])
        manager.show_loading.assert_called_once()
        manager.hide_loading.assert_called_once()
        dialog.grab_release.assert_called_once()
        dialog.destroy.assert_called_once()
        self.assertIsNone(manager.access_dialog)
        self.assertFalse(manager.connecting)

    def test_successful_login_closes_explicit_dialog_once(self):
        manager = self.login_manager()
        dialog = manager.access_dialog
        with patch('desktop.CloudClient'):
            manager.try_connect('password', remember=True, dialog=dialog)
        dialog.destroy.assert_called_once()
        manager.vault.write.assert_called_once_with('password')

    def test_bad_password_keeps_window_open_for_retry(self):
        manager = self.login_manager()
        dialog = manager.access_dialog
        manager.show_error = Mock()
        manager.background = lambda work, complete, failed: failed(AccessDenied('incorrecta'))
        with patch('desktop.CloudClient'):
            manager.try_connect('password', dialog=dialog)
        dialog.destroy.assert_not_called()
        self.assertFalse(manager.connecting)
        manager.show_error.assert_called_once()

    def test_sidebar_scrollbar_hides_when_content_fits_and_returns_on_overflow(self):
        manager = DropperWindow.__new__(DropperWindow)
        manager.side_canvas = Mock()
        manager.side_scroll = Mock()
        manager.list_window = 1
        manager.side_canvas.winfo_width.return_value = 236
        manager.side_canvas.winfo_height.return_value = 400
        manager.side_canvas.bbox.return_value = (0, 0, 236, 150)
        manager.side_scroll.winfo_manager.return_value = 'pack'
        manager.layout_sidebar()
        manager.side_scroll.pack_forget.assert_called_once()
        manager.side_canvas.yview_moveto.assert_called_once_with(0)
        manager.side_canvas.bbox.return_value = (0, 0, 236, 900)
        manager.side_scroll.winfo_manager.return_value = ''
        manager.layout_sidebar()
        manager.side_scroll.pack.assert_called_once_with(side='right', fill='y', before=manager.side_canvas)
