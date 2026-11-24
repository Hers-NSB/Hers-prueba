import unittest
from queue import Queue
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from telegram import ReplyKeyboardMarkup, ReplyKeyboardRemove

from agencykey import AgencyKeyError, Creator, PublishRateLimited, UnconfirmedPost
from bot import CANCEL, CONTINUE, NEW_BATCH, PUBLISH, PUBLISH_NORMAL, PUBLISH_SLOW, RESUME_SLOW, SEND_LINK, SKIP_POST, DropperBot, on_error
from core import Batch, Post


def context():
    return SimpleNamespace(user_data={}, args=[], bot=SimpleNamespace(send_message=AsyncMock(return_value=SimpleNamespace(message_id=900)), edit_message_text=AsyncMock(), delete_message=AsyncMock(), get_file=AsyncMock(), copy_message=AsyncMock(), send_photo=AsyncMock(), send_chat_action=AsyncMock(), send_animation=AsyncMock(return_value=SimpleNamespace(message_id=900)), edit_message_caption=AsyncMock()))


def update(text=None, **kwargs):
    message = SimpleNamespace(text=text, caption=None, photo=[], forward_origin=None,
                              media_group_id=None, message_id=10, reply_text=AsyncMock())
    for key, value in kwargs.items():
        setattr(message, key, value)
    return SimpleNamespace(message=message, effective_message=message,
                           effective_chat=SimpleNamespace(id=123))


def batch_with_posts(count=3):
    batch = Batch(Creator(1, "Modelo", "modelo"))
    batch.received = {i: Post(f"post {i}", None) for i in range(1, count + 1)}
    batch.order = sorted(batch.received)
    return batch


class PublishingTests(unittest.IsolatedAsyncioTestCase):
    async def test_pause_shows_manual_options_and_link_confirms_manual(self):
        api = SimpleNamespace(publish_text=AsyncMock(side_effect=[101, AgencyKeyError("fallo"), 103]))
        bot = DropperBot(api)
        ctx = context()
        batch = batch_with_posts()
        ctx.user_data["batch"] = batch
        await bot.publish_batch(batch, update(), ctx)
        self.assertEqual((batch.status, batch.cursor), ("paused", 1))
        self.assertEqual(api.publish_text.await_count, 2)
        notice = ctx.bot.send_message.call_args.args[1]
        self.assertIn("⏸️ Falló el post #2 de 3 · Modelo", notice)
        self.assertIn("Pega el enlace del post #2", notice)
        ctx.bot.copy_message.assert_awaited_once_with(chat_id=123, from_chat_id=123, message_id=2)
        keyboard = ctx.bot.send_message.call_args.kwargs["reply_markup"]
        self.assertIsInstance(keyboard, ReplyKeyboardMarkup)
        self.assertEqual([[button.text for button in row] for row in keyboard.keyboard],
                         [[SEND_LINK, SKIP_POST]])
        send_link = update(SEND_LINK)
        await bot.menu(send_link, ctx)
        self.assertIn("Pega el enlace de OnlyFans", send_link.effective_message.reply_text.call_args.args[0])
        await bot.menu(update(CONTINUE), ctx)
        ctx.bot.copy_message.assert_awaited_once_with(chat_id=123, from_chat_id=123, message_id=2)
        self.assertEqual((batch.status, batch.cursor), ("paused", 1))
        for link in ("inválido", "https://onlyfans.com/102/otra", "https://onlyfans.com/101/modelo"):
            await bot.menu(update(link), ctx)
            self.assertEqual(batch.cursor, 1)
        await bot.menu(update("https://onlyfans.com/102/modelo"), ctx)
        self.assertEqual(batch.published_ids, {1: "101", 2: "102", 3: "103"})
        self.assertEqual((batch.status, batch.cursor, batch.manual), ("done", 3, [2]))
        self.assertEqual([c.args[1] for c in api.publish_text.call_args_list], ["post 1", "post 2", "post 3"])
        self.assertIn("Total de post: 3 posts", ctx.bot.send_message.call_args.args[1])
        await bot.menu(update(CONTINUE), ctx)
        self.assertEqual(api.publish_text.await_count, 3)

    async def test_omitting_failed_post_preserves_following_posts_and_reports_only_confirmed(self):
        api = SimpleNamespace(publish_text=AsyncMock(side_effect=[101, AgencyKeyError("fallo"), 103]))
        journal = SimpleNamespace(save=Mock(), queue_publication=Mock())
        bot = DropperBot(api, journal=journal, publication_reporting=True)
        ctx = context()
        batch = batch_with_posts()
        ctx.user_data["batch"] = batch
        await bot.publish_batch(batch, update(), ctx)
        await bot.menu(update(SKIP_POST), ctx)

        self.assertEqual((batch.status, batch.cursor, batch.skipped), ("done", 3, [2]))
        self.assertEqual(batch.published_ids, {1: "101", 3: "103"})
        self.assertEqual(bot.session.total, 2)
        self.assertEqual(journal.queue_publication.call_count, 2)
        self.assertIn("Total del Drop: 2", ctx.bot.send_message.call_args.args[1])

    async def test_unconfirmed_last_post_is_not_retried(self):
        api = SimpleNamespace(publish_text=AsyncMock(side_effect=UnconfirmedPost("sin confirmar")))
        batch = batch_with_posts(1)
        bot = DropperBot(api)
        ctx = context()
        ctx.user_data["batch"] = batch
        await bot.publish_batch(batch, update(), ctx)
        self.assertTrue(batch.uncertain)
        await bot.menu(update(CONTINUE), ctx)
        self.assertIn("si ya aparece en el muro", ctx.bot.send_message.call_args.args[1])
        await bot.menu(update("https://onlyfans.com/101/modelo"), ctx)
        self.assertEqual((batch.status, batch.manual), ("done", [1]))
        self.assertEqual(api.publish_text.await_count, 1)
        self.assertIn("Total de post: 1 posts", ctx.bot.send_message.call_args.args[1])

    async def test_unexpected_exception_pauses_and_reports(self):
        api = SimpleNamespace(publish_text=AsyncMock(side_effect=RuntimeError("interno")))
        ctx = context()
        batch = batch_with_posts()
        ctx.user_data["batch"] = batch
        await DropperBot(api).publish_batch(batch, update(), ctx)
        self.assertEqual((batch.status, batch.cursor), ("paused", 0))
        self.assertEqual(api.publish_text.await_count, 1)
        self.assertNotIn("RuntimeError", ctx.bot.send_message.call_args.args[1])
        self.assertIn("⏸️ Falló el post #1 de 3 · Modelo", ctx.bot.send_message.call_args.args[1])

    async def test_photo_download_failure_stops_before_api(self):
        from telegram.error import NetworkError
        api = SimpleNamespace(publish_photo=AsyncMock(), publish_text=AsyncMock(return_value=102))
        ctx = context()
        ctx.bot.get_file.side_effect = NetworkError("sin red")
        batch = batch_with_posts(2)
        batch.received[1] = Post("foto", "file-id")
        ctx.user_data["batch"] = batch
        bot = DropperBot(api)
        await bot.publish_batch(batch, update(), ctx)
        self.assertEqual(batch.status, "paused")
        api.publish_photo.assert_not_awaited()
        api.publish_text.assert_not_awaited()
        await bot.menu(update(CONTINUE), ctx)
        await bot.menu(update("https://onlyfans.com/101/modelo"), ctx)
        api.publish_text.assert_awaited_once_with(1, "post 2", expire=True, slow=False)

    async def test_photo_and_text_publish_newest_message_first(self):
        api = SimpleNamespace(publish_photo=AsyncMock(return_value=102), publish_text=AsyncMock(return_value=101))
        ctx = context()
        ctx.bot.get_file.return_value.download_as_bytearray = AsyncMock(return_value=bytearray(b"photo"))
        batch = Batch(Creator(1, "Modelo", None))
        batch.received = {20: Post("foto", "file"), 10: Post("texto", None)}
        ctx.user_data["batch"] = batch
        await DropperBot(api).publish(update(), ctx)
        self.assertEqual(batch.order, [20, 10])
        self.assertEqual((batch.status, batch.cursor), ("done", 2))
        api.publish_photo.assert_awaited_once_with(1, "foto", b"photo", slow=False)
        messages = [c.args[1] for c in ctx.bot.send_message.call_args_list]
        self.assertTrue(any("Publicando" in text for text in messages))
        self.assertTrue(any("Post #2 confirmado" in text for text in messages))

    async def test_rejected_mention_pauses_newest_post_and_resumes_in_reverse_order(self):
        rejected = AgencyKeyError("AgencyKey respondió HTTP 400. | Detalle: You cannot tag @ask_lola")
        api = SimpleNamespace(publish_text=AsyncMock(side_effect=[rejected, 102, 103]))
        events = Queue()
        bot = DropperBot(api, events=events)
        ctx = context()
        batch = batch_with_posts()
        batch.received[3] = Post("Hola @ask_lola.", None)
        ctx.user_data["batch"] = batch

        await bot.publish(update(), ctx)

        self.assertEqual((batch.order, batch.cursor), ([3, 2, 1], 0))
        self.assertIn("⏸️ Falló el post #1 de 3 · Modelo", ctx.bot.send_message.call_args.args[1])
        await bot.menu(update(CONTINUE), ctx)
        ctx.bot.copy_message.assert_awaited_once_with(chat_id=123, from_chat_id=123, message_id=3)
        await bot.menu(update("https://onlyfans.com/101/modelo"), ctx)

        self.assertEqual([call.args[1] for call in api.publish_text.call_args_list],
                         ["Hola @ask_lola.", "post 2", "post 1"])
        self.assertEqual((batch.status, batch.cursor, batch.manual), ("done", 3, [1]))
        updates = [data for kind, data in list(events.queue) if kind == "publication"]
        self.assertEqual([data["mention"] for data in updates if data["status"] == "paused"], ["@ask_lola"])
        self.assertEqual(updates[-1]["stage"], "Confirmación enviada a Telegram")

    async def test_repeated_manual_confirmations_keep_correct_counts(self):
        api = SimpleNamespace(publish_text=AsyncMock(side_effect=[AgencyKeyError("a"), AgencyKeyError("b"), 103]))
        batch = batch_with_posts()
        await batch.publish(api, AsyncMock())
        batch.confirm_manual()
        await batch.publish(api, AsyncMock())
        self.assertEqual((batch.status, batch.cursor), ("paused", 1))
        batch.confirm_manual()
        await batch.publish(api, AsyncMock())
        self.assertEqual((batch.status, batch.cursor, batch.manual), ("done", 3, [1, 2]))


    async def test_error_notice_does_not_repeat_long_payload(self):
        ctx = context()
        batch = batch_with_posts(1)
        batch.status = "paused"
        batch.failed = True
        batch.error = "error " * 1000
        batch.received[1] = Post("x" * 5000, "photo-id")
        ctx.user_data["batch"] = batch
        await DropperBot(SimpleNamespace()).report(update(), ctx)
        self.assertLess(len(ctx.bot.send_message.call_args.args[1]), 500)
        ctx.bot.copy_message.assert_not_awaited()
        ctx.bot.send_photo.assert_not_awaited()

    async def test_failed_notification_does_not_republish_successful_post(self):
        from telegram.error import NetworkError
        ctx = context()
        ctx.bot.send_message.side_effect = NetworkError("sin red")
        batch = batch_with_posts(1)
        ctx.user_data["batch"] = batch
        api = SimpleNamespace(publish_text=AsyncMock(return_value=101))
        await DropperBot(api).publish_batch(batch, update(), ctx)
        self.assertEqual((batch.status, batch.cursor), ("done", 1))
        api.publish_text.assert_awaited_once()

    async def test_polling_error_notifies_active_chats_and_remembers_if_offline(self):
        from telegram.error import NetworkError
        ctx = context()
        data = {"batch": batch_with_posts()}
        ctx.application = SimpleNamespace(user_data={123: data})
        ctx.error = NetworkError("sin red")
        ctx.bot.send_message.side_effect = NetworkError("sin red")
        await on_error(None, ctx)
        self.assertIn("Error de conexión", data["telegram_error"])
        ctx.bot.send_message.side_effect = None
        await on_error(None, ctx)
        self.assertNotIn("telegram_error", data)


class PublishingOptionsTests(unittest.IsolatedAsyncioTestCase):
    async def test_slow_lot_starts_with_last_received_and_expires_text_posts(self):
        batch = batch_with_posts()
        ctx = context()
        ctx.user_data['batch'] = batch
        api = SimpleNamespace(publish_text=AsyncMock(return_value=101))
        await DropperBot(api).publish(update(PUBLISH_SLOW), ctx)
        self.assertEqual([call.args[1] for call in api.publish_text.await_args_list],
                         ['post 3', 'post 2', 'post 1'])
        self.assertTrue(all(call.kwargs == {'expire': True, 'slow': True}
                            for call in api.publish_text.await_args_list))

    async def test_text_publishes_with_expiration(self):
        ctx = context()
        ctx.user_data['batch'] = batch_with_posts(1)
        api = SimpleNamespace(publish_text=AsyncMock(return_value=101))
        bot = DropperBot(api)
        await bot.publish(update(PUBLISH_NORMAL), ctx)
        api.publish_text.assert_awaited_once_with(1, 'post 1', expire=True, slow=False)

    async def test_rate_limit_pauses_without_advancing_and_can_resume_slow(self):
        ctx = context()
        batch = ctx.user_data['batch'] = batch_with_posts(1)
        api = SimpleNamespace(publish_text=AsyncMock(side_effect=[PublishRateLimited(retry_at=110), 101]))
        bot = DropperBot(api)
        await bot.publish(update(PUBLISH_NORMAL), ctx)
        self.assertEqual((batch.status, batch.cursor, batch.failed), ('paused', 0, False))
        with patch('bot.monotonic', return_value=105):
            await bot.resume(update(RESUME_SLOW), ctx)
        self.assertEqual(api.publish_text.await_count, 1)
        with patch('bot.monotonic', return_value=111):
            await bot.resume(update(RESUME_SLOW), ctx)
        self.assertEqual((batch.status, batch.cursor, batch.manual), ('done', 1, []))
        self.assertTrue(api.publish_text.await_args.kwargs['slow'])


class KeyboardTests(unittest.IsolatedAsyncioTestCase):
    async def test_model_is_fixed_in_desktop_and_no_selection_is_shown(self):
        api = SimpleNamespace(list_creators=AsyncMock())
        creator = Creator(24, 'Lilith', 'lilith')
        bot = DropperBot(api, creator)
        ctx = context()
        event = update('/start')
        await bot.start(event, ctx)
        self.assertEqual(ctx.user_data['batch'].creator, creator)
        api.list_creators.assert_not_awaited()
        self.assertNotIn('Selecciona', event.message.reply_text.call_args.args[0])
        self.assertIsInstance(event.message.reply_text.call_args.kwargs['reply_markup'], ReplyKeyboardRemove)

    async def test_first_forward_opens_batch_without_losing_photo(self):
        ctx = context()
        creator = Creator(24, 'Lilith', 'lilith')
        bot = DropperBot(SimpleNamespace(), creator)
        await bot.receive(update(caption='texto', photo=[SimpleNamespace(file_id='foto')]), ctx)
        self.assertEqual(ctx.user_data['batch'].received[10], Post('texto', 'foto'))
        self.assertEqual(ctx.user_data['batch'].creator, creator)
        bot.cancel_queue_notice(ctx)

    async def test_next_batch_uses_same_fixed_model(self):
        ctx = context()
        creator = Creator(24, 'Lilith', None)
        ctx.user_data['batch'] = Batch(creator, status='done')
        bot = DropperBot(SimpleNamespace(), creator)
        await bot.receive(update('nuevo'), ctx)
        self.assertEqual(ctx.user_data['batch'].creator, creator)
        self.assertEqual(ctx.user_data['batch'].received[10].text, 'nuevo')
        bot.cancel_queue_notice(ctx)

    async def test_missing_model_requests_desktop_configuration(self):
        ctx = context()
        event = update('/start')
        await DropperBot(SimpleNamespace()).start(event, ctx)
        self.assertNotIn('batch', ctx.user_data)
        self.assertIn('app de escritorio', event.message.reply_text.call_args.args[0])

    async def test_actions_are_not_collected_as_posts(self):
        ctx = context()
        batch = Batch(Creator(1, "Modelo", None))
        ctx.user_data["batch"] = batch
        bot = DropperBot(SimpleNamespace())
        for label in (CONTINUE, PUBLISH):
            await bot.menu(update(label), ctx)
        self.assertEqual(batch.received, {})
        await bot.menu(update("post nuevo"), ctx)
        self.assertEqual(batch.received[10].text, "post nuevo")
        await bot.menu(update(CANCEL), ctx)
        self.assertNotIn("batch", ctx.user_data)

    async def test_forwarded_button_text_is_content(self):
        ctx = context()
        batch = Batch(Creator(1, "Modelo", None))
        ctx.user_data["batch"] = batch
        await DropperBot(SimpleNamespace()).menu(update(PUBLISH, forward_origin=object()), ctx)
        self.assertEqual(batch.received[10].text, PUBLISH)
        self.assertEqual(batch.status, "collecting")

    async def test_keyboard_for_each_state(self):
        ctx = context()
        for state, expected in [(None, NEW_BATCH), ("collecting", PUBLISH_NORMAL), ("paused", CONTINUE),
                                ("publishing", None), ("done", NEW_BATCH)]:
            if state:
                ctx.user_data["batch"] = batch_with_posts()
                ctx.user_data["batch"].status = state
            keyboard = DropperBot.keyboard(ctx)
            if expected is None:
                self.assertIsInstance(keyboard, ReplyKeyboardRemove)
            else:
                self.assertTrue(keyboard.is_persistent)
                labels = [b.text for row in keyboard.keyboard for b in row]
                self.assertIn(expected, labels)
                self.assertNotIn("📋 Estado", labels)
                self.assertNotIn("👤 Seleccionar modelo", labels)

    async def test_cancel_appears_only_after_collecting_the_first_post(self):
        ctx = context()
        bot = DropperBot(SimpleNamespace(), Creator(1, "Modelo", "modelo"))
        ctx.user_data["batch"] = batch_with_posts(1)
        labels = [button.text for row in bot.keyboard(ctx).keyboard for button in row]
        self.assertIn(CANCEL, labels)


if __name__ == "__main__":
    unittest.main()
