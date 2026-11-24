import socket
import ssl
import unittest
from unittest.mock import patch

import httpx
from connection import network_message, system_proxy, tls_context


class ConnectionTests(unittest.TestCase):
    def test_system_proxy_is_used_on_windows(self):
        with patch('connection.sys.platform','win32'), patch('connection.proxy_bypass',return_value=False), patch('connection.getproxies',return_value={'https':'http://127.0.0.1:8080'}):
            self.assertEqual(system_proxy('https://dropper.test'),'http://127.0.0.1:8080')

    def test_proxy_bypass_is_respected(self):
        with patch('connection.sys.platform','win32'), patch('connection.proxy_bypass',return_value=True):
            self.assertIsNone(system_proxy('https://dropper.test'))

    def test_ssl_checks_are_enabled_outside_windows(self):
        with patch('connection.sys.platform','linux'):
            self.assertIs(tls_context(),True)

    def test_certificate_error_reports_cause_without_exposing_credentials(self):
        error=httpx.ConnectError('private-api-key')
        error.__cause__=ssl.SSLCertVerificationError(1,'certificate verify failed')
        message=network_message(error)
        self.assertIn('certificado HTTPS',message)
        self.assertNotIn('private-api-key',message)

    def test_dns_timeout_and_proxy_errors_are_distinct(self):
        error=httpx.ConnectError('private-api-key')
        error.__cause__=socket.gaierror(11001,'getaddrinfo failed')
        self.assertIn('DNS',network_message(error))
        self.assertIn('tiempo de espera',network_message(httpx.ConnectTimeout('private')))
        self.assertIn('proxy',network_message(httpx.ProxyError('private')))
