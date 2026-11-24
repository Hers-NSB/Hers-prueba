import tempfile
import unittest
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from telegram.ext import ApplicationHandlerStop

from agencykey import Creator
from batch_journal import BatchJournal
from cloud_client import CloudError
from bot import DropperBot
from core import Batch, Post
import recorder


class DropJournalTests(unittest.IsolatedAsyncioTestCase):
    async def test_crash_after_dispatch_requires_link_and_keeps_confirmed_ids(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(recorder, 'ROOT', Path(folder)):
            model = Creator(52, 'Modelo', 'modelo')
            journal = BatchJournal(99)
            batch = Batch(model, status='publishing', cursor=1, awaiting_confirmation=True,
                          order=[2, 1], received={2: Post('publicado', None), 1: Post('pendiente', None)},
                          published_ids={1: '101'})
            journal.save(123, batch)
            recovered = BatchJournal(99).load(123, model)
            self.assertEqual(recovered.published_ids, {1: '101'})
            self.assertEqual(recovered.cursor, 1)
            self.assertEqual(recovered.status, 'paused')
            self.assertTrue(recovered.failed and recovered.uncertain)
            self.assertIsNone(journal.load(123, Creator(99, 'Otra', 'otra')))

    def test_publications_survive_restart_and_are_removed_only_after_sync(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(recorder, 'ROOT', Path(folder)):
            model = Creator(52, 'Modelo', 'modelo')
            journal = BatchJournal(99)
            batch = Batch(model, status='done', cursor=2, order=[2, 1],
                          manual=[2], skipped=[1], published_ids={2: '102'})
            journal.queue_publication(batch, manual=True)
            journal.save(123, batch)

            journal = BatchJournal(99)
            self.assertEqual(journal.load(123, model).skipped, [1])
            stop = Event()

            def offline(records):
                self.assertEqual(len(records), 1)
                stop.set()
                raise CloudError('offline', retryable=True)

            journal.sync_publications(SimpleNamespace(report_publications=offline), stop)
            self.assertEqual(len(list((journal.root/'publications').glob('*.json'))), 1)
            stop.clear()

            def online(records):
                self.assertEqual((records[0]['position'], records[0]['post_id'], records[0]['manual']),
                                 (2, '102', True))
                stop.set()

            journal.sync_publications(SimpleNamespace(report_publications=online), stop)
            self.assertEqual(list((journal.root/'publications').glob('*.json')), [])

    async def test_users_are_denied_by_default_and_a_bound_name_cannot_transfer(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(recorder, 'ROOT', Path(folder)):
            model = Creator(52, 'Modelo', 'modelo')
            def update(name, user_id):
                return SimpleNamespace(effective_user=SimpleNamespace(username=name, id=user_id),
                    effective_chat=SimpleNamespace(id=user_id, type='private'), effective_message=None)
            context = SimpleNamespace(user_data={})
            bot = DropperBot(AsyncMock(), model, telegram_users=(), journal=BatchJournal(99))
            with self.assertRaises(ApplicationHandlerStop):
                await bot.authorize(update('editor', 123), context)
            bot = DropperBot(AsyncMock(), model, telegram_users=['editor'], journal=BatchJournal(99))
            await bot.authorize(update('Editor', 123), context)
            new_instance = DropperBot(AsyncMock(), model, telegram_users=['editor'], journal=BatchJournal(99))
            with self.assertRaises(ApplicationHandlerStop):
                await new_instance.authorize(update('editor', 321), context)
            await new_instance.authorize(update('editor', 123), context)
