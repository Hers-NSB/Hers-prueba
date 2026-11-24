import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from telegram.constants import ChatType
from telegram.error import BadRequest

from agencykey import AgencyKeyError, Creator
from bot import DropperBot, PUBLISH
from core import Batch, Post
from test_publisher_flow import context, update


class PreparationTests(unittest.IsolatedAsyncioTestCase):
    async def test_thirty_photos_produce_one_queue_confirmation(self):
        ctx = context()
        batch = Batch(Creator(1, 'Lilith', None))
        ctx.user_data['batch'] = batch
        bot = DropperBot(SimpleNamespace())
        for number in range(1, 31):
            await bot.receive(update(caption=f'post {number}', message_id=number,
                                     photo=[SimpleNamespace(file_id=str(number))]), ctx)
        task = ctx.user_data['queue_notice_task']
        with patch('bot.asyncio.sleep', new_callable=AsyncMock):
            await task
        ctx.bot.send_message.assert_awaited_once()
        self.assertIn('30 posts en cola', ctx.bot.send_message.call_args.args[1])
        self.assertEqual(set(batch.received), set(range(1, 31)))
        await bot.receive(update('post 31', message_id=31), ctx)
        with patch('bot.asyncio.sleep', new_callable=AsyncMock):
            await ctx.user_data['queue_notice_task']
        ctx.bot.send_message.assert_awaited_once()
        self.assertIn('31 posts', ctx.bot.edit_message_text.call_args.args[0])

    async def test_originals_deleted_only_after_all_posts_complete(self):
        ctx = context()
        batch = Batch(Creator(1, 'Lilith', None))
        batch.received = {10: Post('one', None), 20: Post('two', None)}
        ctx.user_data.update(batch=batch, prepublish_ids={1, 2, 10, 20})
        async def publish(*args, **kwargs):
            self.assertFalse(any(call.args[1] in {1, 2, 10, 20}
                                 for call in ctx.bot.delete_message.call_args_list))
            return 45
        api = SimpleNamespace(publish_text=AsyncMock(side_effect=publish))
        await DropperBot(api).publish(update(PUBLISH, message_id=21), ctx)
        deleted = {call.args[1] for call in ctx.bot.delete_message.call_args_list}
        self.assertTrue({1, 2, 10, 20}.issubset(deleted))
        self.assertNotIn(21, deleted)
        texts = [call.args[1] for call in ctx.bot.send_message.call_args_list]
        self.assertTrue(any('✅ Post #2 confirmado' == text for text in texts))
        self.assertFalse(any('ID:' in text or text.endswith('.') for text in texts))

    async def test_pause_keeps_originals_and_continue_cleans(self):
        ctx = context()
        batch = Batch(Creator(1, 'Lilith', None))
        batch.received = {10: Post('one', None), 20: Post('two', None)}
        ctx.user_data.update(batch=batch, prepublish_ids={10, 20})
        api = SimpleNamespace(publish_text=AsyncMock(side_effect=[AgencyKeyError('x' * 5000), 99]))
        bot = DropperBot(api)
        await bot.publish(update(PUBLISH), ctx)
        self.assertEqual(batch.status, 'paused')
        self.assertEqual(batch.cleanup_ids, {10, 20})
        self.assertFalse(any(c.args[1] in {10, 20} for c in ctx.bot.delete_message.call_args_list))
        await bot.resume(update(), ctx)
        await bot.menu(update('https://onlyfans.com/98/lilith'), ctx)
        self.assertEqual(batch.status, 'done')
        self.assertEqual(batch.manual, [1])
        self.assertTrue({10, 20}.issubset({c.args[1] for c in ctx.bot.delete_message.call_args_list}))
        self.assertEqual(api.publish_text.await_count, 2)

    async def test_delete_failure_does_not_change_publication_result(self):
        ctx = context()
        batch = Batch(Creator(1, 'Lilith', None))
        batch.status = 'done'
        batch.cursor = 1
        batch.cleanup_ids = {10, 11}
        ctx.user_data['batch'] = batch
        ctx.bot.delete_message.side_effect = [BadRequest('too old'), None]
        await DropperBot(SimpleNamespace()).report(update(), ctx)
        self.assertEqual(batch.status, 'done')
        self.assertEqual(ctx.bot.delete_message.await_count, 2)
        self.assertIn('Drop finalizado', ctx.bot.send_message.call_args.args[1])
        self.assertTrue(any('No se pudieron borrar 1' in c.args[1] for c in ctx.bot.send_message.call_args_list))

    async def test_authorization_tracks_prep_but_excludes_publish_button(self):
        ctx = context()
        bot = DropperBot(SimpleNamespace())
        for number, text in enumerate(('/start', 'model', PUBLISH), 1):
            event = update(text, message_id=number)
            event.effective_user = SimpleNamespace(id=123)
            event.effective_chat.type = ChatType.PRIVATE
            await bot.authorize(event, ctx)
        self.assertEqual(ctx.user_data['prepublish_ids'], {1, 2})

    async def test_loading_updates_and_stops_when_publication_finishes(self):
        ctx = context()
        batch = Batch(Creator(1, 'Lilith', None))
        batch.order = [10]
        batch.received[10] = Post('one', None)
        ctx.user_data['batch'] = batch
        edited = asyncio.Event()
        async def edit(*args, **kwargs):
            edited.set()
        ctx.bot.edit_message_text.side_effect = edit
        async def publish(*args, **kwargs):
            await asyncio.wait_for(edited.wait(), 1)
            return 77
        await DropperBot(SimpleNamespace(publish_text=AsyncMock(side_effect=publish))).publish_batch(batch, update(), ctx)
        self.assertIn('Publicando post #1', ctx.bot.edit_message_text.call_args.args[0])
        ctx.bot.delete_message.assert_any_await(123, 900)
        self.assertEqual(batch.status, 'done')
