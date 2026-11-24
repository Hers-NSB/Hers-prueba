import json
from pathlib import Path
import socket
import ssl
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

import httpx

import recorder
import recorder_network as network


class WindowsConnectionTests(unittest.TestCase):
    def test_windows_certificates_and_explicit_ca_are_loaded(self):
        context = Mock()
        truststore = SimpleNamespace(SSLContext=Mock(return_value=context))
        with patch.object(network.sys, 'platform', 'win32'), \
             patch.dict(sys.modules, {'truststore': truststore}), \
             patch.dict(network.os.environ, {'SSL_CERT_FILE': 'company.pem'}, clear=True):
            self.assertIs(network.tls_context(), context)
        truststore.SSLContext.assert_called_once_with(ssl.PROTOCOL_TLS_CLIENT)
        context.load_verify_locations.assert_called_once_with(cafile='company.pem', capath=None)

    def test_proxy_bypass_and_socks_normalization(self):
        with patch.object(network.sys, 'platform', 'win32'), \
             patch.object(network, 'proxy_bypass', return_value=False), \
             patch.object(network, 'getproxies', return_value={'https': 'socks://localhost:1080'}):
            self.assertEqual(network.system_proxy('https://api.telegram.org'), 'socks5://localhost:1080')
            with patch.object(network, 'proxy_bypass', return_value=True):
                self.assertIsNone(network.system_proxy('https://api.telegram.org'))

    def test_https_options_keep_verification_and_system_proxy(self):
        context = object()
        with patch.object(network, 'tls_context', return_value=context), \
             patch.object(network, 'system_proxy', return_value='http://proxy:8080'):
            options = network.telegram_connection_options()
        self.assertIs(options['verify'], context)
        self.assertEqual(options['proxy'], 'http://proxy:8080')


class TelegramNetworkTests(unittest.IsolatedAsyncioTestCase):
    async def test_network_errors_identify_stage_without_exposing_token(self):
        certificate = httpx.ConnectError('private URL /bot12345:SECRET')
        certificate.__cause__ = ssl.SSLCertVerificationError('certificate verify failed')
        dns = httpx.ConnectError('private URL /bot12345:SECRET')
        dns.__cause__ = socket.gaierror('getaddrinfo failed')
        cases = [(certificate, 'certificate', False), (dns, 'dns', False),
                 (httpx.ProxyError('SECRET'), 'proxy', False),
                 (httpx.ConnectTimeout('SECRET'), 'connect', False),
                 (httpx.WriteTimeout('SECRET'), 'write_timeout', True),
                 (httpx.ReadTimeout('SECRET'), 'read_timeout', True),
                 (httpx.ReadError('SECRET'), 'interrupted', True)]
        for error, category, uncertain in cases:
            with self.subTest(category=category):
                client = Mock(post=AsyncMock(side_effect=error))
                with self.assertRaises(network.TelegramFailure) as raised:
                    await network.telegram_request(client, 'sendVideo')
                self.assertEqual(raised.exception.category, category)
                self.assertEqual(raised.exception.uncertain, uncertain)
                self.assertIn('enviar video', str(raised.exception))
                self.assertNotIn('SECRET', str(raised.exception))
                client.post.assert_awaited_once()

    async def test_timeout_before_upload_does_not_claim_delivery_unknown(self):
        client = Mock(post=AsyncMock(side_effect=httpx.ReadTimeout('SECRET')))
        with self.assertRaises(network.TelegramFailure) as raised:
            await network.telegram_request(client, 'getMe')
        self.assertFalse(raised.exception.uncertain)
        self.assertIn('comprobar bot', str(raised.exception))

    async def test_http_errors_are_distinct_from_network_errors(self):
        for status in (400, 401, 403, 409, 413, 429, 500):
            with self.subTest(status=status):
                response = httpx.Response(status, json={'ok': False, 'description': 'SECRET'})
                client = Mock(post=AsyncMock(return_value=response))
                with self.assertRaises(network.TelegramFailure) as raised:
                    await network.telegram_request(client, 'sendVideo')
                self.assertEqual(raised.exception.category, f'http_{status}')
                self.assertEqual(raised.exception.uncertain, status >= 500)
                self.assertNotIn('SECRET', str(raised.exception))

    async def test_invalid_send_confirmation_is_uncertain(self):
        for response in (httpx.Response(200, text='not JSON SECRET'),
                         httpx.Response(200, json=[]),
                         httpx.Response(200, json={'ok': True, 'result': {}})):
            with self.subTest(response=response.text):
                client = Mock(post=AsyncMock(return_value=response))
                with self.assertRaises(network.TelegramFailure) as raised:
                    await network.telegram_request(client, 'sendVideo')
                self.assertTrue(raised.exception.uncertain)
                self.assertNotIn('SECRET', str(raised.exception))

    async def test_unknown_upload_is_saved_and_not_retried_automatically(self):
        code, calls = [], []
        def capture(message, *args, **kwargs):
            if str(message).startswith('Envía este texto exacto'):
                code.append(str(message).split()[-1])
        def handler(request):
            method = request.url.path.rsplit('/', 1)[-1]
            calls.append(method)
            if method == 'getMe':
                result = {'username': 'test_recorder_bot'}
            elif method == 'getWebhookInfo':
                result = {'url': ''}
            elif method == 'getUpdates':
                result = [{'message': {'text': code[-1], 'chat': {'id': 42, 'type': 'private'}}}]
            else:
                raise httpx.ReadTimeout('https://api.telegram.org/bot12345:SECRET/sendVideo', request=request)
            return httpx.Response(200, json={'ok': True, 'result': result})
        original_client = httpx.AsyncClient
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'report.json'
            path.write_text('{}')
            video = Path(directory) / 'comprobante.mp4'
            video.write_bytes(b'video')
            report = {'status': 'complete', 'seen': ['1'], 'post_ids': ['1']}
            with patch.object(recorder, 'verified_video', return_value=(report, video)), \
                 patch.object(network, 'telegram_connection_options', return_value={'verify': True}), \
                 patch.object(recorder, 'read_bot_token', return_value='12345:SECRET'), \
                 patch('builtins.input', side_effect=['test_recorder_bot', '']), \
                 patch('builtins.print', side_effect=capture), \
                 patch.object(httpx, 'AsyncClient', side_effect=lambda **kw: original_client(
                     transport=httpx.MockTransport(handler), **kw)):
                with self.assertRaisesRegex(network.TelegramFailure, 'entrega no está confirmada'):
                    await recorder.send(path)
            saved = json.loads(path.read_text())
            self.assertEqual(saved['telegram_attempt']['status'], 'delivery_unknown')
            self.assertEqual(saved['telegram_attempt']['method'], 'sendVideo')
            self.assertNotIn('SECRET', path.read_text())
            self.assertEqual(calls.count('sendVideo'), 1)
            self.assertEqual(saved['status'], 'complete')
            with patch.object(recorder, 'verified_video', return_value=(saved, video)), \
                 patch('builtins.input', return_value=''), patch.object(recorder, 'read_bot_token') as token:
                with self.assertRaisesRegex(ValueError, 'Reenvío cancelado'):
                    await recorder.send(path)
                token.assert_not_called()

    async def test_confirmed_video_is_not_sent_again(self):
        with patch.object(recorder, 'verified_video', return_value=({'telegram': {'message_id': 7}}, Path('unused'))), \
             patch.object(recorder, 'read_bot_token') as token:
            with self.assertRaisesRegex(ValueError, 'ya tiene un envío confirmado'):
                await recorder.send(Path('unused'))
            token.assert_not_called()


if __name__ == '__main__':
    unittest.main()
