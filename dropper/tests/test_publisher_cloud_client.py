import unittest
from unittest.mock import patch

import httpx

from cloud_client import CloudClient, CloudError


class CloudClientTests(unittest.TestCase):
    def test_metadata_listing_never_requests_credentials(self):
        calls = []
        def respond(request):
            calls.append(request)
            return httpx.Response(200, json={'profiles': [{'id': 'p', 'name': 'Bot'}]})
        client = CloudClient('access', transport=httpx.MockTransport(respond))
        self.assertEqual(client.list_profiles()[0]['name'], 'Bot')
        self.assertEqual(calls[0].url.path, '/v1/profiles')
        self.assertEqual(calls[0].headers['authorization'], 'Bearer access')

    def test_desktop_exposes_no_configuration_mutation_methods(self):
        client = CloudClient('access')
        self.assertFalse(hasattr(client, 'save_profile'))
        self.assertFalse(hasattr(client, 'delete_profile'))
        self.assertFalse(hasattr(client, 'admin_url'))

    def test_access_denied_is_actionable(self):
        client = CloudClient('invalid', transport=httpx.MockTransport(lambda r: httpx.Response(401)))
        with self.assertRaisesRegex(CloudError, 'incorrecta o cambiada'):
            client.list_profiles()

    def test_http_is_rejected(self):
        with self.assertRaises(ValueError):
            CloudClient('access', base_url='http://example.com')

    def test_redirect_never_forwards_access_token(self):
        calls = []
        def respond(request):
            calls.append(request)
            return httpx.Response(302, headers={'Location': 'https://other.example'})
        client = CloudClient('access', transport=httpx.MockTransport(respond))
        with self.assertRaises(CloudError):
            client.list_profiles()
        self.assertEqual(len(calls), 1)

    def test_credentials_read_does_not_write_files(self):
        profile = {'telegram_token': 'token', 'api_key': 'key', 'creator': {}}
        client = CloudClient('access', transport=httpx.MockTransport(lambda r: httpx.Response(200, json=profile)))
        with patch('pathlib.Path.write_text') as write:
            self.assertEqual(client.credentials('id'), profile)
        write.assert_not_called()

    def test_failed_network_does_not_expose_response_or_token(self):
        def respond(request):
            raise httpx.ConnectError('private-token', request=request)
        client = CloudClient('private-token', transport=httpx.MockTransport(respond))
        with self.assertRaisesRegex(CloudError, 'No se pudo conectar') as result:
            client.list_profiles()
        self.assertNotIn('private-token', str(result.exception))


    def test_unicode_password_is_encoded_for_http_headers(self):
        import base64
        calls=[]
        def respond(request):
            calls.append(request)
            return httpx.Response(200,json={'profiles':[]})
        password='Contraseña 🔐 2026'
        client=CloudClient(password,transport=httpx.MockTransport(respond))
        self.assertEqual(client.list_profiles(),[])
        header=calls[0].headers['authorization']
        self.assertTrue(header.startswith('Dropper '))
        encoded=header.split(' ',1)[1]
        self.assertEqual(base64.urlsafe_b64decode(encoded+'='*(-len(encoded)%4)).decode('utf-8'),password)

    def test_real_client_uses_verified_context_and_system_proxy(self):
        with patch('cloud_client.tls_context',return_value='verified-context'), patch('cloud_client.system_proxy',return_value='http://127.0.0.1:8080'), patch('cloud_client.httpx.Client') as factory:
            factory.return_value.__enter__.return_value.request.return_value=httpx.Response(200,json={'profiles':[]})
            self.assertEqual(CloudClient('access').list_profiles(),[])
        self.assertEqual(factory.call_args.kwargs['verify'],'verified-context')
        self.assertEqual(factory.call_args.kwargs['proxy'],'http://127.0.0.1:8080')
        self.assertFalse(factory.call_args.kwargs['follow_redirects'])
