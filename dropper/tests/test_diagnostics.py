import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch
from zipfile import ZipFile

import diagnostics
import recorder


class ExportTests(unittest.TestCase):
    def test_archive_excludes_storage_and_redacts_registered_secrets(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(recorder, 'ROOT', Path(directory)), \
                patch('config.SECRETS', {'private-api-key'}):
            folder = Path(directory) / 'diagnostics' / '20261117'
            folder.mkdir(parents=True)
            (folder / 'diagnostic.json').write_text(json.dumps({'error': 'private-api-key',
                'url': 'https://app.agencykey.com/models/52?token=hidden', 'detail': 'Bearer abc'}))
            (folder / 'chrome.png').write_bytes(b'png')
            (folder / 'session.json').write_text('secret cookies')
            (Path(directory) / 'private').mkdir()
            (Path(directory) / 'private/session.json').write_text('secret storage')
            target = Path(directory) / 'report.zip'
            self.assertEqual(diagnostics.export_diagnostics(target, 'private-api-key'), 1)
            with ZipFile(target) as archive:
                self.assertEqual(len(archive.namelist()), 4)
                self.assertFalse(any('session' in name for name in archive.namelist()))
                self.assertEqual(archive.read('recorder-registro.txt'), b'[oculto]')
                report = json.loads(archive.read('diagnosticos/20261117/diagnostic.json'))
                self.assertEqual(report['error'], '[oculto]')
                self.assertEqual(report['detail'], 'Bearer [oculto]')
                self.assertEqual(report['url'], 'https://app.agencykey.com/models/52')

    def test_urls_remove_credentials_queries_and_unrecognized_paths(self):
        self.assertEqual(diagnostics.safe_url('https://name:password@app.agencykey.com/models/52?token=secret#secret'),
                         'https://app.agencykey.com/models/52')
        self.assertNotIn('secret', diagnostics.safe_url('https://api.telegram.org/bot123:secret/sendMessage'))


class CaptureTests(unittest.IsolatedAsyncioTestCase):
    async def test_closed_browser_still_produces_exportable_error(self):
        page = SimpleNamespace(url='https://app.agencykey.com/models/52?token=private',
                               is_closed=lambda: True)
        with tempfile.TemporaryDirectory() as directory, patch.object(recorder, 'ROOT', Path(directory)):
            try:
                raise ValueError('fallo de prueba')
            except ValueError as error:
                folder = await diagnostics.capture_failure(page, kind='grabacion',
                    profile_url=recorder.model_profile_url(52), username='modelo', error=error,
                    stage='marcar inicio', post_ids=['123'])
            report = json.loads((folder / 'diagnostic.json').read_text())
            self.assertIn('raise ValueError', report['traceback'])
            self.assertEqual(report['post_ids'], ['123'])
            self.assertEqual(report['screenshot_omitted'], 'login_or_closed')
            self.assertNotIn('private', report['opened_url'])

    async def test_login_screen_is_not_captured(self):
        page = SimpleNamespace(url='https://app.agencykey.com/auth/signin', is_closed=lambda: False,
                               frames=[], screenshot=AsyncMock())
        with tempfile.TemporaryDirectory() as directory, patch.object(recorder, 'ROOT', Path(directory)), \
                patch.object(recorder, 'agencykey_sign_in_visible', new=AsyncMock(return_value=True)):
            folder = await diagnostics.capture_failure(page, kind='verificacion',
                profile_url=recorder.model_profile_url(52), status='login_required')
            self.assertTrue((folder / 'diagnostic.json').is_file())
        page.screenshot.assert_not_awaited()

    async def test_web_failure_is_captured_before_return_and_does_not_leak_internal_error(self):
        import recording_service
        page = SimpleNamespace(goto=AsyncMock(return_value=SimpleNamespace(status=200, ok=True)))
        error = recorder.FeedAccessError('wrong_profile', 'se abrió otra modelo', observed='otra')
        with patch.object(recorder, 'wait_for_model_identity', new=AsyncMock(side_effect=error)), \
                patch.object(diagnostics, 'capture_web_failure', new=AsyncMock(return_value={'error': 'se abrió otra modelo'})) as capture:
            result = await recording_service.verify_profile_route(page, recorder.model_profile_url(52), 'modelo')
        self.assertEqual(result, {'status': 'wrong_profile', 'observed_username': 'otra',
                                 'diagnostic': {'error': 'se abrió otra modelo'}})
        self.assertIs(capture.await_args.kwargs['error'], error)

    async def test_web_diagnostic_does_not_enter_app_export_or_logs(self):
        page = SimpleNamespace(url=recorder.model_profile_url(52), is_closed=lambda: True)
        with tempfile.TemporaryDirectory() as directory, patch.object(recorder, 'ROOT', Path(directory)), \
                patch.object(diagnostics.log, 'error') as app_error:
            report = await diagnostics.capture_web_failure(page, profile_url=page.url,
                username='modelo', error=ValueError('fallo web'), stage='verificar Mi perfil')
            self.assertEqual(report['error'], 'fallo web')
            self.assertFalse((Path(directory) / 'diagnostics').exists())
            target = Path(directory) / 'app.zip'
            self.assertEqual(diagnostics.export_diagnostics(target, 'registro de app'), 0)
            with ZipFile(target) as archive:
                self.assertFalse(any('diagnostic.json' in name for name in archive.namelist()))
            app_error.assert_not_called()

    async def test_navigation_exception_returns_a_web_result_with_evidence(self):
        import recording_service
        page = SimpleNamespace(goto=AsyncMock(side_effect=ValueError('navegación falló')))
        with patch.object(diagnostics, 'capture_web_failure', new=AsyncMock(return_value={'error': 'navegación falló'})):
            result = await recording_service.verify_profile_route(page, recorder.model_profile_url(52), 'modelo')
        self.assertEqual(result['status'], 'connection_error')
        self.assertEqual(result['diagnostic']['error'], 'navegación falló')

    async def test_desktop_button_exports_zip(self):
        from desktop import BotPanel
        panel = SimpleNamespace(manager=SimpleNamespace(root=None),
            activity=SimpleNamespace(get=Mock(return_value='registro')), append=Mock())
        with patch('desktop.filedialog.asksaveasfilename', return_value='report.zip') as dialog, \
                patch.object(diagnostics, 'export_diagnostics', return_value=2) as export:
            BotPanel.save_log(panel)
        self.assertEqual(dialog.call_args.kwargs['defaultextension'], '.zip')
        export.assert_called_once_with('report.zip', 'registro')

    async def test_remounted_profile_is_retried_and_identity_checked_again(self):
        page = SimpleNamespace(url=recorder.model_profile_url(52), wait_for_timeout=AsyncMock())
        with patch.object(recorder, 'monotonic', side_effect=[0, 1, 4, 5]), \
                patch.object(recorder, 'agencykey_sign_in_visible', new=AsyncMock(return_value=False)), \
                patch.object(recorder, 'visible_model_profiles', new=AsyncMock(side_effect=[set(), set(), set(), {(52, 'modelo')}])), \
                patch.object(recorder, 'open_my_profile', new=AsyncMock(return_value=True)) as activate:
            result = await recorder.wait_for_model_identity(page, page.url, 'modelo', deadline=10)
        self.assertEqual(result, 'modelo')
        self.assertEqual(activate.await_count, 2)

    async def test_wrong_model_never_passes_after_retries(self):
        page = SimpleNamespace(url=recorder.model_profile_url(52), wait_for_timeout=AsyncMock())
        with patch.object(recorder, 'monotonic', side_effect=[0, 4, 8, 11]), \
                patch.object(recorder, 'agencykey_sign_in_visible', new=AsyncMock(return_value=False)), \
                patch.object(recorder, 'visible_model_profiles', new=AsyncMock(return_value={(99, 'otra')})), \
                patch.object(recorder, 'open_my_profile', new=AsyncMock(return_value=True)) as activate:
            with self.assertRaises(recorder.FeedAccessError) as caught:
                await recorder.wait_for_model_identity(page, page.url, 'modelo', deadline=10)
        self.assertEqual(caught.exception.status, 'wrong_profile')
        self.assertEqual(activate.await_count, 3)

    async def test_visible_short_feed_uses_scroll_limit_without_requiring_115_pixels(self):
        cards = [{'id': '123', 'pinned': False, 'top': 200, 'height': 250}]
        frame = SimpleNamespace(evaluate=AsyncMock(side_effect=[None, cards, cards, 720]))
        page = SimpleNamespace(main_frame=frame, frames=[frame])
        with patch.object(recorder, 'images_ready', new=AsyncMock()), \
                patch.object(recorder, 'frame_is_visible', new=AsyncMock(return_value=True)), \
                patch.object(recorder, 'scroll_down', new=AsyncMock(return_value=False)):
            result = await recorder.confirm_start(page, frame, '123', reframe=True)
        self.assertEqual(result['top'], 200)
        self.assertEqual(result['alignment'], 'scroll_limit')


class BrowserRegressionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from playwright.async_api import async_playwright
        self.pw = await async_playwright().start()
        self.browser = await recorder.launch_browser(self.pw, headless=True)
        self.page = await self.browser.new_page(viewport={'width': 1280, 'height': 720})

    async def asyncTearDown(self):
        await self.browser.close()
        await self.pw.stop()

    async def test_web_capture_returns_jpeg_without_persisting_app_diagnostics(self):
        import base64
        await self.page.set_content('<main>Perfil de prueba<input value="campo privado"></main>')
        with tempfile.TemporaryDirectory() as directory, patch.object(recorder, 'ROOT', Path(directory)):
            report = await diagnostics.capture_web_failure(self.page, profile_url=recorder.model_profile_url(52),
                username='modelo', error=ValueError('fallo exclusivo de la web'), stage='verificar Mi perfil')
            self.assertEqual(report['screenshot']['mime'], 'image/jpeg')
            self.assertTrue(base64.b64decode(report['screenshot']['data']).startswith(b'\xff\xd8\xff'))
            self.assertFalse((Path(directory) / 'diagnostics').exists())

    async def test_short_feed_accepts_visible_start_when_scrolling_is_impossible(self):
        await self.page.set_content('<style>body{margin:0}main{height:500px;padding-top:200px;box-sizing:border-box}'
            'article{height:250px}</style><main><article id="postId_123">Post visible</article></main>')
        result = await recorder.seek_start(self.page, '123', timeout=3)
        verified = await recorder.confirm_start(self.page, result['_frame'], '123', reframe=True)
        self.assertEqual(verified['top'], 200)
        self.assertEqual(verified['alignment'], 'scroll_limit')

    async def test_unreachable_start_under_header_still_fails(self):
        await self.page.set_content('<style>body{margin:0}article{height:250px}</style>'
                                    '<article id="postId_123">Post oculto por cabecera</article>')
        with self.assertRaisesRegex(ValueError, 'ya no está encuadrado'):
            await recorder.confirm_start(self.page, self.page.main_frame, '123', reframe=True)

    async def test_profile_reloads_after_first_click_then_second_click_verifies(self):
        loads = 0
        async def serve(route):
            nonlocal loads
            if 'app.agencykey.com' in route.request.url:
                body = '<style>body{margin:0}iframe{width:1280px;height:720px;border:0}</style>' \
                       '<iframe src="https://of-52.agencykey.com/"></iframe>'
            elif route.request.url.endswith('/modelo'):
                loads += 1
                body = ('<main id="content"><div class="js-compact-sticky-header">Perfil</div></main>'
                        if loads > 1 else '<nav><a href="/modelo">Mi perfil</a></nav>')
            else:
                body = '<nav><a href="/modelo">Mi perfil</a></nav>'
            await route.fulfill(content_type='text/html', body=body)
        await self.page.route('https://**.agencykey.com/**', serve)
        url = recorder.model_profile_url(52)
        await self.page.goto(url)
        observed = await recorder.wait_for_model_identity(self.page, url, 'modelo', deadline=recorder.monotonic() + 9)
        self.assertEqual(observed, 'modelo')
        self.assertEqual(loads, 2)

    async def test_capture_has_frame_geometry_images_identity_and_masked_screenshot(self):
        await self.page.set_content('<main id="content"><div class="js-compact-sticky-header">Perfil</div>'
            '<article id="postId_123" style="margin-top:150px;height:200px">Prueba'
            '<img width="20" height="20" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'/%3E">'
            '<input value="private-api-key"></article></main>')
        with tempfile.TemporaryDirectory() as directory, patch.object(recorder, 'ROOT', Path(directory)):
            folder = await diagnostics.capture_failure(self.page, kind='grabacion',
                profile_url=recorder.model_profile_url(52), username='modelo', error=ValueError('encuadre'), post_ids=['123'])
            report = json.loads((folder / 'diagnostic.json').read_text())
            self.assertTrue((folder / 'chrome.png').stat().st_size > 0)
            self.assertTrue(report['frames'][0]['profile_header'])
            self.assertEqual(report['frames'][0]['cards'][0]['id'], '123')
            self.assertEqual(report['frames'][0]['images'][0]['post_id'], '123')
            self.assertNotIn('private-api-key', json.dumps(report))
