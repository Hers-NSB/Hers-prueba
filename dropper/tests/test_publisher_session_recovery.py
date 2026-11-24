import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from telegram.error import BadRequest, NetworkError

from agencykey import AgencyKeyError, Creator
from bot import DropperBot
from core import Batch, Post, SessionStats
from test_publisher_flow import batch_with_posts, context, update


class RecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_repeated_continue_copies_failed_post_only_once(self):
        ctx = context()
        batch = batch_with_posts(1)
        ctx.user_data['batch'] = batch
        bot = DropperBot(SimpleNamespace(publish_text=AsyncMock(side_effect=AgencyKeyError('error'))))
        await bot.publish_batch(batch, update(), ctx)
        await bot.status(update(), ctx)
        ctx.bot.copy_message.assert_awaited_once()
        await bot.resume(update(), ctx)
        await bot.resume(update(), ctx)
        ctx.bot.copy_message.assert_awaited_once_with(chat_id=123, from_chat_id=123, message_id=1)
        self.assertEqual(bot.session.total, 0)

    async def test_deleted_original_reconstructed_with_photo_and_full_unicode_text(self):
        ctx = context()
        ctx.bot.copy_message.side_effect = BadRequest('message not found')
        batch = batch_with_posts(1)
        text = '📷' * 5000
        batch.received[1] = Post(text, 'photo')
        await DropperBot(SimpleNamespace()).send_recovery(ctx, 123, batch)
        ctx.bot.send_photo.assert_awaited_once_with(chat_id=123, photo='photo', caption=None)
        chunks = [call.args[1] for call in ctx.bot.send_message.call_args_list]
        self.assertEqual(''.join(chunks), text)
        self.assertTrue(all(len(chunk.encode('utf-16-le')) // 2 <= 4096 for chunk in chunks))
        self.assertTrue(batch.recovery_delivered)

    async def test_deleted_original_short_photo_keeps_caption(self):
        ctx = context()
        ctx.bot.copy_message.side_effect = BadRequest('not found')
        batch = batch_with_posts(1)
        batch.received[1] = Post('caption', 'photo')
        await DropperBot(SimpleNamespace()).send_recovery(ctx, 123, batch)
        ctx.bot.send_photo.assert_awaited_once_with(chat_id=123, photo='photo', caption='caption')
        ctx.bot.send_message.assert_not_awaited()

    async def test_delivery_failure_blocks_manual_confirmation_until_user_can_get_copy(self):
        ctx = context()
        ctx.bot.copy_message.side_effect = NetworkError('offline')
        ctx.bot.send_photo.side_effect = NetworkError('offline')
        batch = batch_with_posts(1)
        batch.received[1] = Post('caption', 'photo')
        batch.status, batch.failed = 'paused', True
        ctx.user_data['batch'] = batch
        api = SimpleNamespace(publish_photo=AsyncMock())
        bot = DropperBot(api)
        await bot.resume(update(), ctx)
        self.assertEqual((batch.cursor, bot.session.total), (0, 0))
        api.publish_photo.assert_not_awaited()
        ctx.bot.copy_message.side_effect = None
        await bot.resume(update(), ctx)
        await bot.menu(update('https://onlyfans.com/101/modelo'), ctx)
        self.assertEqual((batch.status, batch.manual, bot.session.total), ('done', [1], 1))
        api.publish_photo.assert_not_awaited()

    async def test_stopped_batch_resumes_pending_post_without_counting_manual(self):
        ctx = context()
        batch = batch_with_posts(1)
        ctx.user_data['batch'] = batch
        api = SimpleNamespace(stop_requested=lambda: True, publish_text=AsyncMock(return_value=7))
        bot = DropperBot(api)
        await bot.publish_batch(batch, update(), ctx)
        self.assertFalse(batch.failed)
        api.stop_requested = lambda: False
        await bot.resume(update(), ctx)
        api.publish_text.assert_awaited_once_with(1, 'post 1', expire=True, slow=False)
        self.assertEqual((bot.session.automatic, bot.session.manual), (1, 0))


class SessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_counts_across_batches_status_cancel_and_restart(self):
        ctx = context()
        api = SimpleNamespace(publish_text=AsyncMock(side_effect=[7, AgencyKeyError('x'), 8]))
        bot = DropperBot(api)
        batch = batch_with_posts(2)
        ctx.user_data['batch'] = batch
        await bot.publish_batch(batch, update(), ctx)
        await bot.resume(update(), ctx)
        await bot.status(update(), ctx)
        await bot.menu(update('https://onlyfans.com/100/modelo'), ctx)
        self.assertEqual((bot.session.automatic, bot.session.manual), (1, 1))
        ctx.user_data['batch'] = batch_with_posts(1)
        await bot.publish_batch(ctx.user_data['batch'], update(), ctx)
        self.assertEqual(bot.session.total, 3)
        self.assertIn('Total de post: 3 posts', ctx.bot.send_message.call_args.args[1])
        ctx.user_data['batch'] = batch_with_posts(1)
        await bot.cancel(update(), ctx)
        self.assertEqual(bot.session.total, 3)
        self.assertEqual(DropperBot(api).session.total, 0)

    async def test_success_counted_even_when_telegram_notifications_fail(self):
        ctx = context()
        ctx.bot.send_message.side_effect = NetworkError('offline')
        ctx.user_data['batch'] = batch_with_posts(2)
        bot = DropperBot(SimpleNamespace(publish_text=AsyncMock(return_value=7)))
        await bot.publish_batch(ctx.user_data['batch'], update(), ctx)
        self.assertEqual(bot.session.total, 2)



class QueueActivityTests(unittest.IsolatedAsyncioTestCase):
    async def test_different_forward_origins_are_queued_once_in_received_order(self):
        ctx = context()
        ctx.user_data['batch'] = Batch(Creator(1, 'Modelo', None))
        bot = DropperBot(SimpleNamespace())
        for number in range(1, 4):
            event = update(caption=f'post {number}', message_id=number,
                           forward_origin=SimpleNamespace(chat=number),
                           photo=[SimpleNamespace(file_id=str(number))])
            await bot.receive(event, ctx)
            await bot.receive(event, ctx)
        with patch('bot.asyncio.sleep', new_callable=AsyncMock):
            await ctx.user_data['queue_notice_task']
        notice = ctx.bot.send_message.call_args.args[1]
        self.assertIn('3 posts en cola', notice)
        self.assertEqual(notice, '✅ 3 posts en cola')
        self.assertEqual(list(ctx.user_data['batch'].received), [1, 2, 3])

    async def test_reception_during_notice_send_updates_final_count(self):
        ctx = context()
        batch = Batch(Creator(1, 'Modelo', None))
        ctx.user_data['batch'] = batch
        bot = DropperBot(SimpleNamespace())
        async def sending(*args, **kwargs):
            await bot.receive(update('second', message_id=2), ctx)
            return SimpleNamespace(message_id=900)
        ctx.bot.send_message.side_effect = sending
        await bot.receive(update('first', message_id=1), ctx)
        with patch('bot.asyncio.sleep', new_callable=AsyncMock):
            await ctx.user_data['queue_notice_task']
        self.assertIn('2 posts en cola', ctx.bot.edit_message_text.call_args.args[0])
        ctx.bot.send_message.assert_awaited_once()

    async def test_missing_queue_notice_is_replaced(self):
        ctx = context()
        ctx.user_data['queue_notice_id'] = 12
        ctx.bot.edit_message_text.side_effect = BadRequest('message to edit not found')
        await DropperBot(SimpleNamespace()).update_queue_notice(ctx, 123, 'queue', False)
        self.assertEqual(ctx.user_data['queue_notice_id'], 900)
        ctx.bot.send_message.assert_awaited_once()

    async def test_photo_publication_has_no_animation_or_activity(self):
        ctx = context()
        batch = batch_with_posts(1)
        batch.received[1] = Post('caption', 'photo')
        ctx.user_data['batch'] = batch
        ctx.bot.get_file.return_value.download_as_bytearray = AsyncMock(return_value=bytearray(b'photo'))
        bot = DropperBot(SimpleNamespace(publish_photo=AsyncMock(return_value=7)))
        await bot.publish_batch(batch, update(), ctx)
        ctx.bot.send_animation.assert_not_awaited()
        ctx.bot.send_chat_action.assert_not_awaited()
        self.assertEqual(batch.status, 'done')
        self.assertEqual(bot.session.total, 1)
