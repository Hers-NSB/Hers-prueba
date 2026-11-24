import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from agencykey import AgencyKey, AgencyKeyError, PublishRateLimited


class PublishIntervalTests(unittest.IsolatedAsyncioTestCase):
    async def test_first_post_has_no_wait(self):
        api = AgencyKey('test')
        api._publish_once = AsyncMock(return_value=1)
        with patch('agencykey.asyncio.sleep', new_callable=AsyncMock) as sleep:
            self.assertEqual(await api.publish_text(1, 'first'), 1)
            sleep.assert_not_awaited()

    async def test_wait_uses_time_since_previous_completion(self):
        api = AgencyKey('test')
        api._publish_once = AsyncMock(return_value=1)
        api._last_publish_finished[1] = 100
        with patch('agencykey.monotonic', side_effect=[104, 120]), patch('agencykey.asyncio.sleep', new_callable=AsyncMock) as sleep:
            await api.publish_text(1, 'next')
            sleep.assert_awaited_once_with(7)
            self.assertEqual(api._last_publish_finished[1], 120)

    async def test_slow_mode_waits_twenty_two_seconds_from_previous_completion(self):
        api = AgencyKey('test')
        api._publish_once = AsyncMock(return_value=1)
        api._last_publish_finished[1] = 100
        with patch('agencykey.monotonic', return_value=104), patch('agencykey.asyncio.sleep', new_callable=AsyncMock) as sleep:
            await api.publish_text(1, 'next', slow=True)
        sleep.assert_awaited_once_with(18)

    async def test_limit_is_shared_with_other_batches_for_same_model(self):
        api = AgencyKey('test')
        api._publish_once = AsyncMock(side_effect=PublishRateLimited(retry_at=120))
        with patch('agencykey.monotonic', return_value=100):
            for _ in range(2):
                with self.assertRaises(PublishRateLimited):
                    await api.publish_text(1, 'pending')
        api._publish_once.assert_awaited_once()

    async def test_no_extra_wait_after_interval(self):
        api = AgencyKey('test')
        api._publish_once = AsyncMock(return_value=1)
        api._last_publish_finished[1] = 100
        with patch('agencykey.monotonic', return_value=112), patch('agencykey.asyncio.sleep', new_callable=AsyncMock) as sleep:
            await api.publish_text(1, 'next')
            sleep.assert_not_awaited()

    async def test_error_also_starts_interval_and_does_not_retry(self):
        api = AgencyKey('test')
        api._publish_once = AsyncMock(side_effect=AgencyKeyError('failure'))
        with patch('agencykey.monotonic', return_value=100):
            with self.assertRaises(AgencyKeyError):
                await api.publish_text(1, 'first')
        api._publish_once.assert_awaited_once()
        self.assertEqual(api._last_publish_finished[1], 100)

    async def test_other_creator_does_not_inherit_wait(self):
        api = AgencyKey('test')
        api._publish_once = AsyncMock(return_value=1)
        api._last_publish_finished[1] = 100
        with patch('agencykey.asyncio.sleep', new_callable=AsyncMock) as sleep:
            await api.publish_text(2, 'first')
            sleep.assert_not_awaited()

    async def test_simultaneous_batches_same_creator_are_serialized(self):
        api = AgencyKey('test')
        entered = asyncio.Event()
        release = asyncio.Event()
        calls = []
        async def publish_once(creator_id, payload):
            calls.append(payload['text'])
            if len(calls) == 1:
                entered.set()
                await release.wait()
            return len(calls)
        api._publish_once = publish_once
        with patch('agencykey.asyncio.sleep', new_callable=AsyncMock) as sleep:
            first = asyncio.create_task(api.publish_text(1, 'a'))
            await entered.wait()
            second = asyncio.create_task(api.publish_text(1, 'b'))
            release.set()
            await asyncio.gather(first, second)
            self.assertEqual(calls, ['a', 'b'])
            self.assertEqual(sleep.await_count, 1)
            self.assertGreater(sleep.call_args.args[0], 10)
