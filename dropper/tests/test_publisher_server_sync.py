import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from desktop import DropperWindow


def profile(model=52, revision=1, name='Lilith'):
    return {'id':'first','name':name,'bot_id':'12345678','revision':revision,
            'creator':{'external_id':model,'name':name,'username':None}}


class SyncTests(unittest.TestCase):
    def manager(self, panel):
        manager=DropperWindow.__new__(DropperWindow)
        manager.panels={'first':panel}
        manager.selected='first'
        manager.select_available=Mock()
        manager.refresh_sidebar=Mock()
        return manager

    def test_deleted_configuration_is_removed_when_stopped(self):
        panel=Mock(controller=SimpleNamespace(running=False))
        manager=self.manager(panel)
        manager.apply_profiles([])
        self.assertEqual(manager.panels,{})
        self.assertIsNone(manager.selected)
        panel.destroy.assert_called_once()

    def test_deleted_configuration_stops_active_bot_before_removal(self):
        panel=Mock(controller=SimpleNamespace(running=True),removed=False)
        manager=self.manager(panel)
        manager.apply_profiles([])
        self.assertTrue(panel.removed)
        panel.stop.assert_called_once()
        panel.destroy.assert_not_called()

    def test_changed_model_does_not_redirect_a_running_batch(self):
        panel=Mock(controller=SimpleNamespace(running=True),profile=profile())
        manager=self.manager(panel)
        replacement=profile(model=99,revision=2,name='Lola')
        manager.upsert(replacement)
        self.assertEqual(panel.pending_profile,replacement)
        panel.stop.assert_called_once()
        panel.refresh_profile.assert_not_called()

    def test_name_only_update_is_queued_until_bot_stops(self):
        panel=Mock(controller=SimpleNamespace(running=True),profile=profile())
        manager=self.manager(panel)
        replacement=profile(revision=2,name='Lilith actualizada')
        manager.upsert(replacement)
        panel.stop.assert_not_called()
        self.assertEqual(panel.pending_profile,replacement)

    def test_stopped_bot_receives_automatic_name(self):
        panel=Mock(controller=SimpleNamespace(running=False),profile=profile())
        manager=self.manager(panel)
        replacement=profile(revision=2,name='Lilith actualizada')
        manager.upsert(replacement)
        panel.refresh_profile.assert_called_once_with(replacement)
