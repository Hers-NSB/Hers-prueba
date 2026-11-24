import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from telegram.error import NetworkError

from bot import DropperBot, CANCEL, NEW_BATCH
from test_publisher_flow import batch_with_posts, context, update


class ProgressTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_final_report_has_time_and_all_batch_labels_say_drop(self):
        ctx = context()
        batch = batch_with_posts(2)
        ctx.user_data['batch'] = batch
        bot = DropperBot(SimpleNamespace(publish_text=AsyncMock(return_value=7)))
        self.assertEqual(bot.queue_text(batch), '✅ 2 posts en cola')
        self.assertEqual((NEW_BATCH, CANCEL), ('🔄 Nuevo Drop', '❌ Cancelar Drop'))
        await bot.publish_batch(batch, update(), ctx)
        texts = [call.args[1] for call in ctx.bot.send_message.call_args_list]
        texts += [call.args[0] for call in ctx.bot.edit_message_text.call_args_list]
        timed = [text for text in texts if '⏱' in text]
        self.assertEqual(len(timed), 1)
        self.assertIn('✅ Drop finalizado', timed[0])
        self.assertIn('⏱ Tiempo total:', timed[0])
        self.assertFalse(any('estimad' in text.lower() or 'lote' in text.lower() for text in texts))
        self.assertFalse(hasattr(bot.session, 'estimate'))
        self.assertEqual(bot.session.total, 2)

    async def test_cancel_keeps_custom_message_without_stray_brace(self):
        ctx = context()
        ctx.user_data['batch'] = batch_with_posts(1)
        await DropperBot(SimpleNamespace()).cancel(update(), ctx)
        self.assertEqual(ctx.bot.send_message.call_args.args[1], '🗑️ Drop cancelado')
        self.assertNotIn('batch', ctx.user_data)

    async def test_progress_changes_only_for_each_post_without_animation_tasks(self):
        ctx = context()
        batch = batch_with_posts(3)
        ctx.user_data['batch'] = batch
        api = SimpleNamespace(publish_text=AsyncMock(return_value=7))
        with patch('bot.asyncio.create_task') as task:
            await DropperBot(api).publish_batch(batch, update(), ctx)
        task.assert_not_called()
        ctx.bot.send_animation.assert_not_awaited()
        ctx.bot.send_chat_action.assert_not_awaited()
        self.assertEqual(ctx.bot.edit_message_text.await_count, 3)
        for number, call in enumerate(ctx.bot.edit_message_text.call_args_list, 1):
            self.assertIn(f'Publicando post #{number} de 3', call.args[0])
            self.assertNotIn('●', call.args[0])
        notices = [call.args[1] for call in ctx.bot.send_message.call_args_list]
        self.assertEqual([text for text in notices if text.startswith('✅ Post #')],
                         ['✅ Post #1 confirmado', '✅ Post #2 confirmado', '✅ Post #3 confirmado'])

    async def test_edit_failure_does_not_repeat_or_pause_post(self):
        ctx = context()
        batch = batch_with_posts(2)
        ctx.user_data['batch'] = batch
        ctx.bot.edit_message_text.side_effect = NetworkError('offline')
        api = SimpleNamespace(publish_text=AsyncMock(return_value=7))
        bot = DropperBot(api)
        await bot.publish_batch(batch, update(), ctx)
        self.assertEqual((batch.status, bot.session.total, api.publish_text.await_count), ('done', 2, 2))
