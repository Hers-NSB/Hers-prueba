import unittest
from unittest.mock import patch

import httpx

from agencykey import AgencyKey, AgencyKeyError, UnconfirmedPost


class PublishErrorTests(unittest.IsolatedAsyncioTestCase):
    async def publish_response(self, status, body):
        transport = httpx.MockTransport(lambda request: httpx.Response(status, json=body))
        real_client = httpx.AsyncClient
        with patch('agencykey.httpx.AsyncClient', side_effect=lambda **kw: real_client(transport=transport, **kw)):
            return await AgencyKey('test-api-key').publish_text(1, 'post')

    async def test_400_includes_server_detail(self):
        with self.assertRaises(AgencyKeyError) as error:
            await self.publish_response(400, {'error': {'code': 123, 'message': 'Invalid media'}})
        self.assertIn('Código 123', str(error.exception))
        self.assertIn('Invalid media', str(error.exception))
        self.assertNotIsInstance(error.exception, UnconfirmedPost)

    async def test_500_preserves_uncertain_result_and_detail(self):
        with self.assertRaises(UnconfirmedPost) as error:
            await self.publish_response(500, {'message': 'Upstream failure'})
        self.assertIn('Upstream failure', str(error.exception))

    async def test_actual_api_key_is_hidden(self):
        with self.assertRaises(AgencyKeyError) as error:
            await self.publish_response(400, {'message': 'Rejected test-api-key'})
        self.assertNotIn('test-api-key', str(error.exception))

    async def test_missing_detail_does_not_invent_reason(self):
        with self.assertRaises(AgencyKeyError) as error:
            await self.publish_response(400, {})
        self.assertIn('Sin código ni mensaje', str(error.exception))

    async def test_details_message_is_read(self):
        with self.assertRaises(AgencyKeyError) as error:
            await self.publish_response(400, {'details': {'errorCode': 'INVALID', 'message': 'Validation failed'}})
        self.assertIn('Validation failed', str(error.exception))


if __name__ == '__main__':
    unittest.main()
