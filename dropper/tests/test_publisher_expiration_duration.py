import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from agencykey import AgencyKey, AgencyKeyError, Creator
from core import Batch, Post
from bot import DropperBot


class ExpirationTests(unittest.IsolatedAsyncioTestCase):
    async def test_photo_has_one_day_expiration(self):
        api = AgencyKey('test')
        api._upload_photo = AsyncMock(return_value={'processId': 'photo'})
        api._publish = AsyncMock(return_value=101)
        await api.publish_photo(1, 'texto', b'\xff\xd8\xffphoto')
        api._publish.assert_awaited_once_with(1, {
            'text': 'texto', 'mediaFiles': [{'processId': 'photo'}], 'expireDays': 1,
        }, slow=False)

    async def test_text_only_expiration_is_forwarded_to_agencykey(self):
        for expire in (True, False):
            api = AgencyKey('test')
            api._publish = AsyncMock(return_value=101)
            await api.publish_text(1, 'texto', expire=expire, slow=True)
            expected = {'text': 'texto', 'expireDays': 1} if expire else {'text': 'texto'}
            api._publish.assert_awaited_once_with(1, expected, slow=True)


class DurationTests(unittest.IsolatedAsyncioTestCase):
    def batch(self):
        batch = Batch(Creator(1, 'Modelo', None))
        batch.received = {1: Post('uno', None), 2: Post('dos', None)}
        batch.order = [1, 2]
        return batch

    async def test_elapsed_is_frozen_after_completion(self):
        batch = self.batch()
        api = SimpleNamespace(publish_text=AsyncMock(return_value=101))
        with patch('core.monotonic', side_effect=[100, 604]):
            await batch.publish(api, AsyncMock())
        self.assertEqual(batch.elapsed_text, '8 min 24 s')
        with patch('core.monotonic', side_effect=AssertionError('must not read clock')):
            self.assertEqual(batch.elapsed_text, '8 min 24 s')

    async def test_pause_resume_includes_pause_and_keeps_start(self):
        batch = self.batch()
        api = SimpleNamespace(publish_text=AsyncMock(side_effect=[AgencyKeyError('fallo'), 101]))
        with patch('core.monotonic', return_value=100):
            await batch.publish(api, AsyncMock())
        self.assertIsNone(batch.finished_at)
        batch.confirm_manual()
        with patch('core.monotonic', return_value=3745):
            await batch.publish(api, AsyncMock())
        self.assertEqual(batch.started_at, 100)
        self.assertEqual(batch.elapsed_text, '1 h 0 min 45 s')

    async def test_finished_message_contains_duration(self):
        batch = self.batch()
        batch.status = 'done'
        batch.cursor = 2
        batch.started_at, batch.finished_at = 100, 165
        ctx = SimpleNamespace(user_data={'batch': batch}, bot=SimpleNamespace(send_message=AsyncMock()))
        update = SimpleNamespace(effective_chat=SimpleNamespace(id=123),
                                 effective_message=SimpleNamespace(reply_text=AsyncMock()))
        await DropperBot(SimpleNamespace()).report(update, ctx)
        self.assertIn('Tiempo total: 1 min 05 s', ctx.bot.send_message.call_args.args[1])

    def test_timer_start_is_not_reset(self):
        batch = self.batch()
        self.assertEqual(batch.elapsed_text, '0 min 00 s')
        with patch('core.monotonic', side_effect=[0, 20]):
            batch.start_timer()
            batch.start_timer()
            self.assertEqual(batch.elapsed_text, '0 min 20 s')
