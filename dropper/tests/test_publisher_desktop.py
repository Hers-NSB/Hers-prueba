import logging
import queue
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from agencykey import AgencyKey, AgencyKeyError, Creator
from app_paths import application_dir, resource_path
from config import ConsoleFormatter
from core import Batch, Post
from desktop_runtime import BotController, run_application


class SettingsTests(unittest.TestCase):
    def test_frozen_path(self):
        executable = str(Path(tempfile.gettempdir()) / 'dropper' / 'Dropper.exe')
        with patch.object(sys, 'frozen', True, create=True), patch.object(sys, 'executable', executable):
            self.assertEqual(application_dir(), Path(executable).resolve().parent)

    def test_profile_exists(self):
        self.assertTrue(resource_path('agencykey-perfiles.json').is_file())

    def test_logs_hide_keys(self):
        with patch.dict('os.environ', TELEGRAM_TOKEN='123:secret', AGENCYKEY_API_KEY='secret-key'):
            record = logging.LogRecord('test', logging.ERROR, '', 0, '123:secret secret-key', (), None)
            self.assertEqual(ConsoleFormatter('%(message)s').format(record), '[oculto] [oculto]')


class ControllerTests(unittest.TestCase):
    def test_no_duplicate_worker_and_restart(self):
        events = queue.Queue()
        entered = threading.Event()
        def runner(stop, ready):
            ready()
            entered.set()
            stop.wait(2)
        controller = BotController(events, runner)
        self.assertTrue(controller.start())
        self.assertTrue(entered.wait(1))
        self.assertFalse(controller.start())
        controller.stop()
        controller.thread.join(2)
        self.assertFalse(controller.running)
        self.assertEqual(events.get_nowait(), ('ready', None))
        self.assertEqual(events.get_nowait(), ('stopped', False))
        self.assertTrue(controller.start())
        controller.stop()
        controller.thread.join(2)
        self.assertFalse(controller.running)

    def test_failure_reaches_window(self):
        def runner(stop, ready):
            raise SystemExit(1)
        events = queue.Queue()
        controller = BotController(events, runner)
        controller.start()
        controller.thread.join(2)
        self.assertEqual(events.get_nowait(), ('stopped', True))


class FakeApplication:
    def __init__(self):
        self.running = False
        self.updater = SimpleNamespace(running=False)
        async def start_polling(**kwargs):
            self.updater.running = True
        async def stop_polling():
            self.updater.running = False
        self.updater.start_polling = AsyncMock(side_effect=start_polling)
        self.updater.stop = AsyncMock(side_effect=stop_polling)
        self.start = AsyncMock(side_effect=lambda: setattr(self, 'running', True))
        self.stop = AsyncMock(side_effect=lambda: setattr(self, 'running', False))
        self.closed = False
    async def __aenter__(self):
        return self
    async def __aexit__(self, *args):
        self.closed = True


class LifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_stop_cleans_updater_and_application(self):
        app, event, startup = FakeApplication(), threading.Event(), AsyncMock()
        await run_application(app, startup, event, event.set)
        startup.assert_awaited_once_with(app)
        app.updater.stop.assert_awaited_once()
        app.stop.assert_awaited_once()
        self.assertTrue(app.closed)

    async def test_polling_failure_cleans_application(self):
        app = FakeApplication()
        app.updater.start_polling.side_effect = RuntimeError('startup')
        with self.assertRaises(RuntimeError):
            await run_application(app, AsyncMock(), threading.Event(), lambda: None)
        app.stop.assert_awaited_once()
        self.assertTrue(app.closed)

    async def test_stop_before_start_does_not_poll(self):
        app, event, startup = FakeApplication(), threading.Event(), AsyncMock()
        event.set()
        await run_application(app, startup, event, lambda: None)
        startup.assert_not_awaited()
        app.updater.start_polling.assert_not_awaited()

    async def test_stop_between_posts_preserves_current_result(self):
        api, event = AgencyKey('test'), threading.Event()
        api.stop_requested = event.is_set
        async def publish(*args, **kwargs):
            event.set()
            return 101
        api.publish_text = AsyncMock(side_effect=publish)
        batch = Batch(Creator(1, 'Modelo', None))
        batch.received = {1: Post('uno', None), 2: Post('dos', None)}
        batch.order = [1, 2]
        await batch.publish(api, AsyncMock())
        self.assertEqual((batch.status, batch.cursor), ('paused', 1))
        api.publish_text.assert_awaited_once_with(1, 'uno', expire=True, slow=False)

    async def test_stop_before_request_does_not_create_post(self):
        api = AgencyKey('test')
        api.stop_requested = lambda: True
        api._publish_once = AsyncMock(return_value=101)
        with self.assertRaises(AgencyKeyError):
            await api.publish_text(1, 'uno')
        api._publish_once.assert_not_awaited()


class MultiBotTests(unittest.TestCase):
    def test_workers_run_and_stop_independently(self):
        events_a, events_b = queue.Queue(), queue.Queue()
        ready_a, ready_b = threading.Event(), threading.Event()
        def runner_a(stop, ready):
            ready()
            ready_a.set()
            stop.wait(3)
        def runner_b(stop, ready):
            ready()
            ready_b.set()
            stop.wait(3)
        a, b = BotController(events_a, runner_a), BotController(events_b, runner_b)
        a.start()
        b.start()
        try:
            self.assertTrue(ready_a.wait(1) and ready_b.wait(1))
            self.assertTrue(a.running and b.running)
            a.stop()
            a.thread.join(1)
            self.assertFalse(a.running)
            self.assertTrue(b.running)
            self.assertNotEqual(a.thread_name, b.thread_name)
        finally:
            a.stop()
            b.stop()
            a.thread.join(1)
            b.thread.join(1)

    def test_worker_passes_own_credentials(self):
        controller = BotController(queue.Queue(), credentials=('token-a', 'key-a'))
        with patch('main.main') as run:
            controller._run_bot(threading.Event(), lambda: None)
        self.assertEqual(run.call_args.kwargs['credentials'], ('token-a', 'key-a'))
        self.assertIsNone(run.call_args.kwargs['creator'])

    def test_logs_are_routed_and_all_bot_keys_hidden(self):
        from config import register_secrets
        from desktop import WindowLogHandler
        a, b = queue.Queue(), queue.Queue()
        handler_a, handler_b = WindowLogHandler(a, 'bot-a'), WindowLogHandler(b, 'bot-b')
        register_secrets('token-alpha', 'key-beta')
        record = logging.LogRecord('test', logging.INFO, '', 0, 'token-alpha key-beta', (), None)
        record.threadName = 'bot-a'
        handler_a.emit(record)
        handler_b.emit(record)
        self.assertTrue(b.empty())
        text = a.get_nowait()[1][1]
        self.assertNotIn('token-alpha', text)
        self.assertNotIn('key-beta', text)
        self.assertIn('[oculto]', text)

    def test_cloud_keys_loaded_each_start_and_cleared_on_stop(self):
        from unittest.mock import Mock
        profile = {'telegram_token': 'fake-token', 'api_key': 'fake-key',
                   'creator': {'external_id': 10, 'name': 'Lilith', 'username': None}}
        loader = Mock(return_value=profile)
        controller = BotController(queue.Queue(), credential_loader=loader)
        with patch('main.main') as run:
            for _ in range(2):
                controller.start()
                controller.thread.join(2)
                self.assertIsNone(controller.credentials)
        self.assertEqual(loader.call_count, 2)
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args.kwargs['creator'].external_id, 10)

    def test_stop_while_loading_keys_does_not_start_telegram(self):
        controller = BotController(queue.Queue())
        def load():
            controller.stop_event.set()
            return {'telegram_token': 'fake-token', 'api_key': 'fake-key',
                    'creator': {'external_id': 10, 'name': 'Lilith', 'username': None}}
        controller.credential_loader = load
        with patch('main.main') as run:
            controller.start()
            controller.thread.join(2)
        run.assert_not_called()
        self.assertIsNone(controller.credentials)

    def test_cloud_failure_does_not_start_telegram(self):
        from cloud_client import CloudError
        from unittest.mock import Mock
        controller = BotController(queue.Queue(), credential_loader=Mock(side_effect=CloudError('Sin conexión')))
        with patch('main.main') as run:
            controller.start()
            controller.thread.join(2)
        run.assert_not_called()
        self.assertEqual(controller.events.get_nowait(), ('stopped', True))
        self.assertIsNone(controller.credentials)

class WindowSizeTests(unittest.TestCase):
    def test_window_fits_work_area_without_covering_taskbar(self):
        from desktop import initial_geometry
        for screen_width, screen_height, area in [(1024, 768, (0, 0, 1024, 720)),
                                                   (1920, 1080, (0, 0, 1920, 1040)),
                                                   (1366, 768, (40, 0, 1366, 728))]:
            width, height, x, y = initial_geometry(screen_width, screen_height, area)
            self.assertGreaterEqual(x, area[0])
            self.assertGreaterEqual(y, area[1])
            self.assertLess(x + width, area[2])
            self.assertLess(y + height + 32, area[3])
            self.assertLess(width, screen_width)
            self.assertLess(height, screen_height)
