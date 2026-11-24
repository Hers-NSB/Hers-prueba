import asyncio
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import httpx
from playwright.async_api import Error as BrowserError
from cloud_client import CloudClient, CloudError, AccessDenied
import recorder
import recording_service as service


class RecoveryTests(unittest.IsolatedAsyncioTestCase):
    def test_truncated_cloud_response_can_be_retried(self):
        client = CloudClient('test-access', transport=httpx.MockTransport(
            lambda request: httpx.Response(200, content=b'{', request=request)))
        with self.assertRaises(CloudError) as caught:
            client.recording_session()
        self.assertTrue(caught.exception.retryable)

    async def test_cloud_retry_preserves_result_and_stops_on_invalid_credentials(self):
        stop = threading.Event()
        call = Mock(side_effect=[CloudError('offline', retryable=True), {'active': True}])
        with patch.object(service, 'recovery_pause', new=AsyncMock()):
            self.assertEqual(await service.cloud_retry(call, stop), {'active': True})
        self.assertEqual(call.call_count, 2)
        with self.assertRaises(AccessDenied):
            await service.cloud_retry(Mock(side_effect=AccessDenied('denied')), stop)

    async def test_slow_profile_and_lost_result_retry_the_same_job_and_page(self):
        page = SimpleNamespace(is_closed=lambda: False)
        session = SimpleNamespace(open=AsyncMock(return_value=(page, object())))
        ready_calls = []
        def update(job, **result):
            if result.get('status') == 'ready':
                ready_calls.append((job, result))
                if len(ready_calls) == 1:
                    raise CloudError('lost response', retryable=True)
                return {'active': False}
            return {'active': True}
        client = SimpleNamespace(update_recording_job=update)
        job = {'id': 'same-job', 'claim': 'same-claim', 'kind': 'feed', 'creator_id': 52, 'creator_username': 'modelo'}
        async def pause(*args):
            await asyncio.sleep(.001)
        with patch.object(service, 'recovery_pause', side_effect=pause), \
             patch.object(service, 'verify_profile_route', new=AsyncMock(side_effect=[
                 {'status': 'profile_unverified'}, {'status': 'ready', 'observed_username': 'modelo'}])) as verify:
            await service.run_desktop_recording_job(client, job, threading.Event(), browser_session=session)
        session.open.assert_awaited_once()
        self.assertEqual(verify.await_count, 2)
        self.assertTrue(all(call.args[0] is page for call in verify.await_args_list))
        self.assertEqual(len(ready_calls), 2)
        self.assertEqual(ready_calls[0], ready_calls[1])

    async def test_real_login_request_is_terminal_without_retry(self):
        session = SimpleNamespace(open=AsyncMock(return_value=(object(), object())))
        client = SimpleNamespace(update_recording_job=Mock(return_value={'active': False}))
        job = {'kind': 'feed', 'creator_id': 52, 'creator_username': 'modelo'}
        with patch.object(service, 'verify_profile_route', new=AsyncMock(return_value={'status': 'login_required'})) as verify:
            await service.run_desktop_recording_job(client, job, threading.Event(), browser_session=session)
        verify.assert_awaited_once()
        self.assertEqual(client.update_recording_job.call_args.kwargs['status'], 'login_required')

    async def test_cancel_closes_an_unfinished_browser_operation(self):
        entered = asyncio.Event()
        async def waiting(*args):
            entered.set()
            await asyncio.Event().wait()
        session = SimpleNamespace(open=AsyncMock(side_effect=waiting))
        async def pause(*args):
            await entered.wait()
        client = SimpleNamespace(update_recording_job=Mock(return_value={'active': False}))
        with patch.object(service, 'recovery_pause', side_effect=pause):
            await asyncio.wait_for(service.run_desktop_recording_job(client, {'kind': 'feed'}, threading.Event(),
                                                                    browser_session=session), 2)
        self.assertEqual(client.update_recording_job.call_count, 1)

    async def test_navigation_recovers_multiple_network_cuts(self):
        page = SimpleNamespace(goto=AsyncMock(side_effect=[BrowserError('net::ERR_INTERNET_DISCONNECTED'),
            BrowserError('net::ERR_NETWORK_CHANGED'), SimpleNamespace(status=200)]),
            is_closed=lambda: False, wait_for_timeout=AsyncMock())
        await recorder.navigate_recording_page(page, recorder.model_profile_url(52))
        self.assertEqual(page.goto.await_count, 3)

    async def test_recording_retries_profile_loading_but_rejects_another_identity(self):
        page = SimpleNamespace(is_closed=lambda: False, wait_for_timeout=AsyncMock())
        with patch.object(recorder, 'wait_for_model_identity', new=AsyncMock(side_effect=[
                recorder.FeedAccessError('profile_unverified', 'loading'), 'modelo'])), \
             patch.object(recorder, 'navigate_recording_page', new=AsyncMock()) as navigate:
            self.assertEqual(await recorder.recover_model_profile(page, recorder.model_profile_url(52), 'modelo'), 'modelo')
            navigate.assert_awaited_once()
        with patch.object(recorder, 'wait_for_model_identity', new=AsyncMock(
                side_effect=recorder.FeedAccessError('wrong_profile', 'another model'))):
            with self.assertRaises(recorder.FeedAccessError):
                await recorder.recover_model_profile(page, recorder.model_profile_url(52), 'modelo')

    async def test_switching_models_reuses_browser_and_external_reconnect_replaces_it(self):
        page = SimpleNamespace(is_closed=lambda: False)
        context = SimpleNamespace(new_page=AsyncMock(return_value=page))
        browser = SimpleNamespace(new_context=AsyncMock(return_value=context), close=AsyncMock())
        state = {'cookies': [], 'origins': []}
        client = SimpleNamespace(recording_session=Mock(side_effect=[
            {'state': state, 'connection': 'a'}, {'state': state, 'connection': 'a'},
            {'state': state, 'connection': 'b'}]))
        session = service.VerificationBrowser()
        with patch.object(recorder, 'launch_browser', new=AsyncMock(return_value=browser)) as launch:
            try:
                first, _ = await session.open(client, False, threading.Event())
                second, _ = await session.open(client, False, threading.Event())
                self.assertIs(first, second)
                self.assertEqual(launch.await_count, 1)
                await session.open(client, False, threading.Event())
                self.assertEqual(launch.await_count, 2)
            finally:
                await session.close()
