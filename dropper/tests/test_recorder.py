import asyncio
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch, AsyncMock, Mock

import recorder


class ValidationTests(unittest.TestCase):
    def test_extract_real_link(self):
        self.assertEqual(recorder.post_id('https://onlyfans.com/123456789/test_profile'), '123456789')

    def test_invalid_and_duplicate_ids(self):
        with self.assertRaises(ValueError):
            recorder.post_id('https://example.com/123/user')
        with self.assertRaises(ValueError):
            recorder.validate_config({'profile_url': 'https://app.agencykey.com/models/123', 'post_ids_newest_first': ['1', '1']})

    def test_order_preserved_not_sorted_numerically(self):
        data = recorder.validate_config({'profile_url': 'https://app.agencykey.com/models/123', 'post_ids_newest_first': ['1', '3', '2']})
        self.assertEqual(data['post_ids_newest_first'], ['1', '3', '2'])

    def test_refuse_incomplete_or_tampered_video(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'report.json'
            recorder.save_json(path, {'status': 'incomplete'})
            with self.assertRaises(ValueError):
                recorder.verified_video(path)
            video = path.parent / 'comprobante.mp4'
            video.write_bytes(b'original')
            recorder.save_json(path, {'status': 'complete', 'seen': ['1'], 'post_ids': ['1'], 'sha256': hashlib.sha256(b'original').hexdigest()})
            self.assertEqual(recorder.verified_video(path)[1], video)
            video.write_bytes(b'changed')
            with self.assertRaises(ValueError):
                recorder.verified_video(path)


class ScrollPlanTests(unittest.TestCase):
    def test_distance_and_direction_are_preserved(self):
        import random
        for pixels in (0, 1, -1, 190, 260, -115):
            for seed in range(10):
                steps = recorder.scroll_steps(pixels, rng=random.Random(seed))
                self.assertEqual(sum(delta for delta, _ in steps), pixels)
                self.assertTrue(all(delta * pixels > 0 and pause > 0 for delta, pause in steps))
                if pixels:
                    self.assertLess(sum(pause for _, pause in steps), 600)
                    self.assertTrue(all(pause <= 31 for _, pause in steps))


class TabCaptureTests(unittest.IsolatedAsyncioTestCase):
    async def test_still_tab_uses_explicit_first_and_last_frames(self):
        import base64
        frame = base64.b64encode(b'fixture').decode('ascii')
        session = Mock()
        session.send = AsyncMock(return_value={'data': frame})
        session.detach = AsyncMock()
        page = Mock()
        page.context.new_cdp_session = AsyncMock(return_value=session)
        with tempfile.TemporaryDirectory() as directory:
            capture = recorder.TabCapture(Path(directory) / 'raw')
            await capture.start(page)
            await capture.finish()
            await capture.close()
            self.assertEqual([call.args[0] for call in session.send.await_args_list], [
                'Page.captureScreenshot', 'Page.startScreencast', 'Page.stopScreencast',
                'Page.captureScreenshot',
            ])
            self.assertEqual(len(capture.frames), 2)
            self.assertTrue(all((capture.folder / name).read_bytes() == b'fixture' for _, name in capture.frames))


class TokenInputTests(unittest.TestCase):
    def test_windows_dialog_keeps_secret_out_of_arguments(self):
        import subprocess
        token = '12345:FAKE_TOKEN'
        response = subprocess.CompletedProcess([], 0, token, '')
        with patch.object(recorder.sys, 'platform', 'win32'), patch.object(recorder.shutil, 'which', return_value='powershell.exe'), \
             patch.object(recorder.subprocess, 'run', return_value=response) as run:
            self.assertEqual(recorder.read_bot_token(), token)
        self.assertNotIn(token, str(run.call_args))
        self.assertIn('ShortcutsEnabled = $true', run.call_args.args[0][-1])
        self.assertIn('UseSystemPasswordChar = $true', run.call_args.args[0][-1])

    def test_cancel_does_not_use_partial_token(self):
        import subprocess
        response = subprocess.CompletedProcess([], 2, 'partial', '')
        with patch.object(recorder.sys, 'platform', 'win32'), patch.object(recorder.shutil, 'which', return_value='powershell.exe'), \
             patch.object(recorder.subprocess, 'run', return_value=response):
            with self.assertRaisesRegex(ValueError, 'cancelado'):
                recorder.read_bot_token()


class BrowserTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from playwright.async_api import async_playwright
        self.pw = await async_playwright().start()
        self.browser = await recorder.launch_browser(self.pw, headless=True)
        self.page = await self.browser.new_page(viewport={'width': 1280, 'height': 720})

    async def asyncTearDown(self):
        await self.browser.close()
        await self.pw.stop()

    async def test_virtual_feed_with_delayed_images_and_tall_posts(self):
        await self.page.goto((recorder.RESOURCE_ROOT / 'tests/feed.html').as_uri())
        await recorder.seek_start(self.page, '300', timeout=3)
        seen = await recorder.capture_walk(self.page, ['300', '200', '100'], dwell=.05, timeout=15)
        self.assertEqual(seen, ['300', '200', '100'])
        last = await self.page.locator('#postId_100').bounding_box()
        self.assertLessEqual(last['y'] + last['height'], 700)

    async def test_feed_discovery_scrolls_past_header_to_mount_posts(self):
        await self.page.set_content("""
            <div style="height: 1800px">Perfil de prueba</div>
            <script>
            window.addEventListener('scroll', () => {
                if (!document.getElementById('postId_200') && window.scrollY > 100) {
                    const post = document.createElement('article');
                    post.id = 'postId_200';
                    post.style.cssText = 'height: 500px; position: absolute; top: 340px';
                    document.body.appendChild(post);
                }
            });
            </script>
        """)
        frame = self.page.main_frame
        with patch.object(recorder, 'seek_start', new=AsyncMock(return_value={'_frame': frame})), \
             patch.object(recorder, 'capture_walk', new=AsyncMock()) as walk:
            await recorder.prepare_feed(self.page, ['200'], timeout=5)
        self.assertEqual(await self.page.locator('#postId_200').count(), 1)
        walk.assert_not_awaited()

    async def test_web_verification_matches_the_real_profile_frame_with_empty_wall(self):
        from recording_service import verify_profile_route

        url = 'https://app.agencykey.com/models/52'
        frame_url = 'https://of-52.agencykey.com/modelo'
        await self.page.route(url, lambda route: route.fulfill(content_type='text/html', body=f"""
            <iframe title="OnlyFans" src="{frame_url}" style="width:900px;height:620px"></iframe>
        """))
        await self.page.route(frame_url, lambda route: route.fulfill(content_type='text/html', body="""
            <main id="content">
                <div class="js-compact-sticky-header">Modelo</div>
            </main>
        """))
        result = await verify_profile_route(self.page, url, 'modelo')
        self.assertEqual(result, {'status': 'ready', 'observed_username': 'modelo'})
        profile = self.page.frame_locator('iframe[title="OnlyFans"]')
        self.assertEqual(await profile.locator(recorder.POST_SELECTOR).count(), 0)

    async def test_profile_without_posts_and_nested_feed_with_data_ids(self):
        url = 'https://app.agencykey.com/models/52'
        await self.page.route(url, lambda route: route.fulfill(content_type='text/html', body="""
            <main style="height:700px;overflow:auto;width:390px;margin-left:40px">
              <button>Editar perfil</button><div style="height:900px">Encabezado</div>
              <div id="feed"></div><div style="height:900px"></div>
            </main>
            <div style="position:fixed;left:185px;top:335px;width:45px;height:75px"></div>
            <script>
              const panel = document.querySelector('main');
              panel.addEventListener('scroll', () => {
                if (panel.scrollTop > 220 && !document.querySelector('[data-post-id]')) {
                  document.querySelector('#feed').innerHTML =
                    '<article data-post-id="200" style="height:600px">Primera publicación</article>'
                    + '<article data-post-id="100" style="height:370px">Última publicación</article>';
                }
              });
            </script>
        """))
        await self.page.goto(url, wait_until='domcontentloaded')
        await recorder.wait_for_feed(self.page, url, deadline=recorder.monotonic() + 5)
        self.assertGreater(await self.page.locator('main').evaluate('el => el.scrollTop'), 220)
        first = await recorder.seek_start(self.page, '200', timeout=5)
        self.assertEqual(first['id'], '200')
        self.assertEqual(await recorder.capture_walk(self.page, ['200', '100'], timeout=7, frame=first['_frame']),
                         ['200', '100'])

    async def test_model_navigation_activates_sidebar_my_profile(self):
        url = 'https://app.agencykey.com/models/52'
        await self.page.route(url, lambda route: route.fulfill(content_type='text/html', body="""
            <h1>Mi perfil</h1>
            <nav><button onclick="document.querySelector('article').hidden = false">Mi perfil</button></nav>
            <article id="postId_200" style="height: 300px" hidden>Post de prueba</article>
        """))
        await self.page.goto(url)
        frame = await recorder.wait_for_feed(self.page, url, deadline=recorder.monotonic() + 5)
        self.assertIs(frame, self.page.main_frame)
        self.assertTrue(await frame.locator('#postId_200').is_visible())

    async def test_out_of_order_fails(self):
        await self.page.goto((recorder.RESOURCE_ROOT / 'tests/feed.html').as_uri())
        await recorder.seek_start(self.page, '300', timeout=3)
        with self.assertRaisesRegex(ValueError, 'Orden inesperado'):
            await recorder.capture_walk(self.page, ['300', '100', '200'], dwell=.01, timeout=10)

    async def test_missing_post_and_failed_image(self):
        await self.page.set_content('<div id="postId_1" style="height:500px;margin-top:120px"><img src="http://127.0.0.1:1/missing" style="width:100px;height:100px"></div>')
        from playwright.async_api import TimeoutError
        with self.assertRaises(TimeoutError):
            await recorder.images_ready(self.page, timeout=300)
        await self.page.set_content('<p>Sesión vencida o feed vacío</p>')
        with self.assertRaises(ValueError):
            await recorder.seek_start(self.page, '999', timeout=.1)

    async def test_batch_skips_unrelated_posts_and_keeps_the_visible_drm_warning(self):
        await self.page.set_content('''
            <style>body{margin:0;padding:110px 0 500px}article{height:190px}img{width:100px;height:100px}</style>
            <article id="postId_900" class="m-pinned"><img></article>
            <article id="postId_200"><img><p>Su navegador no admite este tipo de medios.
            Active el <strong>DRM</strong> en este navegador o utilice otro navegador o dispositivo.</p></article>
            <article id="postId_800"><img></article>
            <article data-post-id="100">Último post del lote</article>
        ''')
        await recorder.mask_other_posts(self.page.main_frame, ['200', '100'])
        for selector in ('#postId_900', '#postId_800'):
            self.assertEqual(await self.page.locator(selector).evaluate('e => getComputedStyle(e).opacity'), '0')
        self.assertEqual(await self.page.locator('#postId_200').evaluate('e => getComputedStyle(e).opacity'), '1')
        protected = set()
        capture = SimpleNamespace(accepting=False, checkpoint=AsyncMock())
        seen = await recorder.capture_walk(self.page, ['200', '100'], timeout=8, image_timeout=250,
                                           frame=self.page.main_frame, photo_ids=['200'], capture=capture,
                                           protected_photos=protected)
        self.assertEqual(seen, ['200', '100'])
        self.assertEqual(protected, {'200'})
        capture.checkpoint.assert_awaited()

    async def test_wait_rechecks_late_photos_in_the_same_tab(self):
        await self.page.set_content('<article id="postId_200" style="margin-top:120px">'
                                    '<img style="width:100px;height:100px"></article>')
        notified = asyncio.Event()
        changes = []

        async def notice(post_id):
            changes.append(post_id)
            notified.set()

        photo_wait = recorder.PhotoWaitControl(notice)
        waiting = asyncio.create_task(recorder.images_ready(self.page, timeout=100, photo_ids=['200'],
                                                             photo_wait=photo_wait))
        try:
            await asyncio.wait_for(notified.wait(), 3)
            self.assertFalse(waiting.done())
            self.assertFalse(self.page.is_closed())
            await self.page.locator('img').evaluate('''img => { img.src = 'data:image/svg+xml,' + encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'); }''')
            await asyncio.wait_for(waiting, 5)
            self.assertEqual(changes, ['200', None])
            self.assertFalse(self.page.is_closed())
        finally:
            if not waiting.done():
                waiting.cancel()
                await asyncio.gather(waiting, return_exceptions=True)

    async def test_closed_chrome_ends_the_photo_pause(self):
        await self.page.set_content('<article id="postId_200" style="margin-top:120px">'
                                    '<img style="width:100px;height:100px"></article>')
        from playwright.async_api import Error

        async def close_chrome(post_id):
            await self.browser.close()

        with self.assertRaisesRegex(Error, 'closed'):
            await recorder.images_ready(self.page, timeout=100, photo_ids=['200'],
                                        photo_wait=recorder.PhotoWaitControl(close_chrome))

    async def test_failure_diagnostics_omit_private_content_and_urls(self):
        await self.page.set_content('<div id="postId_1" style="margin-top:120px;height:500px">Private caption'
                                    '<img src="http://127.0.0.1:1/secret?token=PRIVATE" style="width:100px;height:100px"></div>')
        diagnostics = await recorder.failure_diagnostics(self.page)
        self.assertEqual(diagnostics[0]['cards'][0]['id'], '1')
        self.assertFalse(diagnostics[0]['images'][0]['loaded'])
        self.assertNotIn('PRIVATE', json.dumps(diagnostics))
        self.assertNotIn('Private caption', json.dumps(diagnostics))

    async def test_failed_visible_record_preserves_progress_and_waits_before_closing(self):
        from playwright.async_api import TimeoutError
        async def fail_walk(page, ids, **kwargs):
            kwargs['seen'].append('300')
            raise TimeoutError('secret browser URL?token=PRIVATE')
        async def inspect_open_browser(page):
            self.assertFalse(page.is_closed())
        async def first_post(page, *args, **kwargs):
            return {'_frame': page.main_frame}
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'session.json'
            await self.page.context.storage_state(path=str(state))
            with patch.object(recorder, 'ROOT', Path(directory)), patch.object(recorder, 'STATE', state), \
                 patch.object(recorder, 'prepare_feed', new=AsyncMock(side_effect=first_post)), \
                 patch.object(recorder, 'confirm_start', new=AsyncMock(return_value={'post_id': '300', 'visible': True})), \
                 patch.object(recorder.TabCapture, 'start', new=AsyncMock()), \
                 patch.object(recorder, 'capture_walk', side_effect=fail_walk), \
                 patch.object(recorder, 'pause_failed_test', side_effect=inspect_open_browser) as pause, \
                 patch.object(recorder, 'launch_browser', new=AsyncMock(return_value=self.browser)):
                # Use an existing browser to exercise real context/video cleanup without a desktop.
                await self.page.route('https://app.agencykey.com/**', lambda route: route.fulfill(body='fixture'))
                original = self.browser.new_context
                async def routed_context(**kwargs):
                    context = await original(**kwargs)
                    await context.route('https://app.agencykey.com/**', lambda route: route.fulfill(body='fixture'))
                    return context
                with patch.object(self.browser, 'new_context', side_effect=routed_context):
                    with self.assertRaisesRegex(ValueError, 'recorrer posts / cargar imágenes'):
                        await recorder.record({'profile_url': 'https://app.agencykey.com/models/123',
                                               'post_ids_newest_first': ['300', '200']})
                pause.assert_awaited_once()
            report_path = next(Path(directory).glob('output/*/report.json'))
            report = json.loads(report_path.read_text())
            self.assertFalse(report['headless'])
            self.assertEqual(report['seen'], ['300'])
            self.assertEqual(report['next_post_id'], '200')
            self.assertEqual(report['error_type'], 'TimeoutError')
            self.assertEqual(report['status'], 'incomplete')
            self.assertNotIn('PRIVATE', report_path.read_text())
            self.assertFalse((report_path.parent / 'raw').exists())
            with self.assertRaisesRegex(ValueError, 'no está completo'):
                recorder.verified_video(report_path)

    async def test_pinned_post_does_not_define_start(self):
        await self.page.set_content('<div id="postId_1" class="m-pinned" style="height:200px;margin-top:120px">fijado</div>')
        with self.assertRaises(ValueError):
            await recorder.seek_start(self.page, '1', timeout=.1)

    async def test_profile_header_without_posts_can_save_session(self):
        context = self.page.context
        await self.page.route('https://app.agencykey.com/**', lambda route: route.fulfill(
            content_type='text/html', body='<h1>Mi perfil</h1><p>Cabecera de la modelo</p>'))
        await self.page.goto('https://app.agencykey.com/models/12345')
        await self.page.evaluate("localStorage.setItem('test-session', 'fixture-only')")
        self.assertEqual(await self.page.locator('[id^="postId_"]').count(), 0)
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'private' / 'session.json'
            with patch.object(recorder, 'STATE', state):
                await recorder.save_login_session(self.page, context, 'https://app.agencykey.com/models/12345')
            self.assertTrue(state.exists())
            saved = json.loads(state.read_text(encoding='utf-8'))
            self.assertTrue(any(origin['origin'] == 'https://app.agencykey.com' for origin in saved['origins']))
            self.assertFalse(state.with_suffix('.tmp').exists())

    async def test_posts_inside_an_iframe_are_found_and_scrolled(self):
        from html import escape
        source = (recorder.RESOURCE_ROOT / 'tests/feed.html').read_text(encoding='utf-8')
        await self.page.set_content('<style>body{margin:0}iframe{position:absolute;left:0;top:130px;width:1280px;height:560px;border:0}</style>'
                                    + '<h1>AgencyKey fixture</h1><iframe srcdoc="' + escape(source, quote=True) + '"></iframe>')
        await self.page.frames[1].wait_for_selector('[id^="postId_"]')
        self.assertEqual(await self.page.locator('[id^="postId_"]').count(), 0)
        first = await recorder.seek_start(self.page, '300', timeout=5)
        self.assertIsNot(first['_frame'], self.page.main_frame)
        seen = await recorder.capture_walk(self.page, ['300', '200', '100'], dwell=.01, timeout=20, frame=first['_frame'])
        self.assertEqual(seen, ['300', '200', '100'])

    async def test_hidden_tab_and_hidden_main_cards_do_not_select_recording_panel(self):
        from html import escape
        source = (recorder.RESOURCE_ROOT / 'tests/feed.html').read_text(encoding='utf-8')
        await self.page.set_content('<style>body{margin:0}iframe{position:absolute;left:0;top:0;width:1280px;height:720px;border:0}</style>'
            '<div style="visibility:hidden"><article id="postId_200" style="height:500px">stale main tab</article></div>'
            '<iframe style="visibility:hidden" srcdoc="' + escape(source, quote=True) + '"></iframe>'
            '<iframe srcdoc="' + escape(source, quote=True) + '"></iframe>')
        hidden, visible = self.page.frames[1:]
        await visible.wait_for_selector('#postId_300')
        self.assertFalse(await recorder.frame_is_visible(self.page, hidden))
        self.assertIs(await recorder.post_frame(self.page), visible)
        first = await recorder.seek_start(self.page, '200', timeout=10)
        self.assertIs(first['_frame'], visible)
        self.assertEqual(await hidden.evaluate('scrollY'), 0)
        verified = await recorder.confirm_start(self.page, visible, '200')
        self.assertTrue(verified['visible'] and verified['images_ready'])
        with self.assertRaisesRegex(ValueError, 'panel oculto'):
            await recorder.confirm_start(self.page, hidden, '200')
        await self.page.locator('iframe').nth(1).evaluate('e => e.style.visibility="hidden"')
        with self.assertRaisesRegex(ValueError, 'quedó oculto'):
            await recorder.capture_walk(self.page, ['200', '100'], frame=visible)

    async def test_start_revalidation_rejects_recycled_or_moved_post(self):
        await self.page.goto((recorder.RESOURCE_ROOT / 'tests/feed.html').as_uri())
        first = await recorder.seek_start(self.page, '200', timeout=10)
        await self.page.locator('#postId_200').evaluate('e => e.id="postId_999"')
        with self.assertRaisesRegex(ValueError, 'ya no está encuadrado'):
            await recorder.confirm_start(self.page, first['_frame'], '200')

    async def test_direct_capture_exports_the_first_and_last_viewport(self):
        import subprocess

        await self.page.set_content('<style>body{background:#00bb00}</style>')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            capture = recorder.TabCapture(root / 'raw')
            try:
                await capture.start(self.page)
                await self.page.evaluate("document.body.style.background = '#dd0000'")
                await self.page.wait_for_timeout(250)
                await capture.finish()
            finally:
                await capture.close()
            video = root / 'capture.mp4'
            capture.encode(video)
            pixels = subprocess.run([recorder.ffmpeg_path(), '-v', 'error', '-i', str(video),
                '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'],
                check=True, capture_output=True).stdout
            self.assertGreater(pixels[1], 150)
            self.assertGreater(pixels[-3], 170)
            self.assertLess(pixels[-2], 40)
            self.assertGreater(len(capture.frames), 2)

    async def test_export_starts_on_requested_post_in_visible_iframe(self):
        from html import escape
        import subprocess
        source = (recorder.RESOURCE_ROOT / 'tests/feed.html').read_text(encoding='utf-8')
        # Hidden frame has the same IDs; the visible panel starts one post too early.
        wrapper = ('<style>body{margin:0}iframe{position:absolute;left:0;top:0;width:1280px;height:720px;border:0}</style>'
                   '<iframe style="visibility:hidden" srcdoc="' + escape(source, quote=True) + '"></iframe>'
                   '<iframe srcdoc="' + escape(source, quote=True) + '"></iframe>')
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / 'nested-feed.html'
            fixture.write_text(wrapper, encoding='utf-8')
            with patch.object(recorder, 'ROOT', Path(directory)):
                report_path = await recorder.record({'profile_url': 'SIMULACIÓN', 'post_ids_newest_first': ['200', '100']},
                                                    fixture=fixture, headless=True)
            report = json.loads(report_path.read_text())
            self.assertEqual(report['start_verified']['post_id'], '200')
            self.assertEqual(report['start_verified']['frame_index'], 2)
            self.assertEqual(report['status'], 'complete')
            decoded = subprocess.run([recorder.ffmpeg_path(), '-hide_banner', '-loglevel', 'error',
                '-i', str(report_path.parent / 'comprobante.mp4'), '-frames:v', '1', '-threads', '1',
                '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], check=True, capture_output=True).stdout
            offset = (250 * 854 + 400) * 3
            red, green, blue = decoded[offset:offset+3]
            self.assertGreater(green, red + 40)
            self.assertGreater(green, blue + 12)

    async def test_successful_recording_keeps_refreshed_session_state(self):
        source = (recorder.RESOURCE_ROOT / 'tests/feed.html').read_text(encoding='utf-8')
        source += '<script>localStorage.setItem("recorder-refresh-fixture","yes")</script>'
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'session.json'
            state.write_text('{"cookies":[],"origins":[]}')
            original = self.browser.new_context
            async def routed_context(**kwargs):
                context = await original(**kwargs)
                await context.route('https://app.agencykey.com/**', lambda route: route.fulfill(
                    content_type='text/html', body=source))
                return context
            with patch.object(recorder,'ROOT',Path(directory)), \
                 patch.object(recorder,'launch_browser',new=AsyncMock(return_value=self.browser)), \
                 patch.object(self.browser,'new_context',side_effect=routed_context):
                report_path = await recorder.record({'profile_url':'https://app.agencykey.com/models/52',
                    'post_ids_newest_first':['200','100']},headless=True,session_path=state)
            report=json.loads(report_path.read_text())
            self.assertTrue(report['session_refreshed'])
            saved=json.loads(state.read_text())
            self.assertTrue(any(item['name']=='recorder-refresh-fixture' and item['value']=='yes'
                                for origin in saved['origins'] for item in origin.get('localStorage',[])))

    async def test_dom_scroll_uses_page_mode_ancestor_without_wheel(self):
        await self.page.set_content("""
            <main id="content" style="height:420px;overflow-y:auto">
              <div class="js-compact-sticky-header">Mi perfil</div>
              <section class="vue-recycle-scroller ready" page-mode style="height:3000px"></section>
            </main>
            <script>
              window.wheels = 0;
              window.addEventListener('wheel', () => wheels++);
            </script>
        """)
        self.assertTrue(await recorder.scroll_down(self.page, 190))
        self.assertEqual(await self.page.evaluate('wheels'), 0)
        self.assertEqual(await self.page.locator('main').evaluate('el => el.scrollTop'), 190)
        self.assertEqual(await self.page.evaluate('scrollY'), 0)

    async def test_start_is_selected_post_not_first_feed_post(self):
        await self.page.goto((recorder.RESOURCE_ROOT / 'tests/feed.html').as_uri())
        first = await recorder.seek_start(self.page, '200', timeout=10)
        self.assertEqual(first['id'], '200')
        cards = await first['_frame'].evaluate(recorder.SNAPSHOT)
        selected = next(card for card in cards if card['id'] == '200')
        self.assertTrue(95 <= selected['top'] <= 145)
        self.assertFalse(any(card['id'] == '300' and card['bottom'] > 100 for card in cards))
        seen = await recorder.capture_walk(self.page, ['200', '100'], timeout=15, frame=first['_frame'])
        self.assertEqual(seen, ['200', '100'])


class TelegramTests(unittest.IsolatedAsyncioTestCase):
    async def test_send_uses_challenge_chat_and_keeps_token_out_of_report(self):
        import httpx
        token = '12345:TEST_TOKEN'
        sent = []
        code = []
        def fake_print(message, *args, **kwargs):
            if 'recorder-' in str(message):
                code.append(str(message).split()[-1])
        def handler(request):
            method = request.url.path.rsplit('/', 1)[-1]
            if method == 'getMe':
                result = {'username': 'test_recorder_bot'}
            elif method == 'getWebhookInfo':
                result = {'url': ''}
            elif method == 'getUpdates':
                result = [{'message': {'text': code[-1], 'chat': {'id': 42, 'type': 'private'}}}]
            elif method == 'sendVideo':
                sent.append(request)
                result = {'message_id': 7}
            else:
                raise AssertionError(method)
            return httpx.Response(200, json={'ok': True, 'result': result})
        actual_client = httpx.AsyncClient
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'report.json'
            video = path.parent / 'comprobante.mp4'
            video.write_bytes(b'test video')
            recorder.save_json(path, {'status': 'complete', 'seen': ['1'], 'post_ids': ['1'],
                                     'sha256': hashlib.sha256(video.read_bytes()).hexdigest()})
            with patch.object(recorder, 'read_bot_token', return_value=token), patch('builtins.input', side_effect=['test_recorder_bot', '']), \
                 patch('recorder_network.telegram_connection_options', return_value={'verify': True}), \
                 patch('builtins.print', side_effect=fake_print), \
                 patch.object(httpx, 'AsyncClient', side_effect=lambda **kw: actual_client(transport=httpx.MockTransport(handler), **kw)):
                await recorder.send(path)
            self.assertEqual(len(sent), 1)
            self.assertIn(b'42', sent[0].content)
            self.assertNotIn(token, path.read_text())
            self.assertEqual(json.loads(path.read_text())['telegram']['chat_id'], 42)

    async def test_incomplete_report_never_requests_token_or_sends(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'report.json'
            recorder.save_json(path, {'status': 'incomplete'})
            with patch.object(recorder, 'read_bot_token') as prompt:
                with self.assertRaises(ValueError):
                    await recorder.send(path)
                prompt.assert_not_called()


class SessionValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_wrong_model_does_not_overwrite_saved_session(self):
        page = Mock(url='https://app.agencykey.com/models/999')
        context = Mock(storage_state=AsyncMock())
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'session.json'
            state.write_text('original', encoding='utf-8')
            with patch.object(recorder, 'STATE', state):
                with self.assertRaisesRegex(ValueError, 'modelo configurada'):
                    await recorder.save_login_session(page, context, 'https://app.agencykey.com/models/123')
            self.assertEqual(state.read_text(), 'original')
        context.storage_state.assert_not_awaited()

    async def test_login_page_or_foreign_domain_is_not_saved(self):
        for url in ['https://app.agencykey.com/login', 'https://example.com/models/123']:
            context = Mock(storage_state=AsyncMock())
            with self.assertRaises(ValueError):
                await recorder.save_login_session(Mock(url=url), context, 'https://app.agencykey.com/models/123')
            context.storage_state.assert_not_awaited()


class VisibilityTests(unittest.TestCase):
    def test_cli_record_and_demo_show_browser_unless_headless_is_explicit(self):
        for command in ('record', 'demo'):
            for flags, expected in (([], False), (['--show-browser'], False), (['--headless'], True)):
                with self.subTest(command=command, flags=flags), \
                     patch.object(recorder.sys, 'argv', ['recorder.py', command, *flags]), \
                     patch.object(recorder, 'load_config', return_value={}), \
                     patch.object(recorder, 'record', new=AsyncMock()) as record:
                    recorder.main()
                    self.assertEqual(record.call_args.kwargs['headless'], expected)

    def test_menu_propagates_visibility_to_recording(self):
        for headless in (False, True):
            with patch('builtins.input', side_effect=['3', '0']), \
                 patch.object(recorder, 'load_config', return_value={}), \
                 patch.object(recorder, 'record', new=AsyncMock()) as record:
                recorder.menu(headless=headless)
                self.assertEqual(record.call_args.kwargs['headless'], headless)


class BrowserSetupTests(unittest.IsolatedAsyncioTestCase):
    async def test_installed_chrome_channel_is_used(self):
        browser = object()
        playwright = Mock()
        playwright.chromium.launch = AsyncMock(return_value=browser)
        self.assertIs(await recorder.launch_browser(playwright, headless=False), browser)
        playwright.chromium.launch.assert_awaited_once_with(channel='chrome', headless=False)

    async def test_missing_chrome_fails_without_installing(self):
        playwright = Mock()
        playwright.chromium.launch = AsyncMock(side_effect=RuntimeError("Executable doesn't exist"))
        with patch.object(recorder, 'find_chrome', return_value=None), patch.object(recorder.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'No se encontró Google Chrome'):
                await recorder.launch_browser(playwright, headless=True)
        run.assert_not_called()
        self.assertEqual(playwright.chromium.launch.await_count, 1)

    async def test_user_installed_chrome_fallback(self):
        browser = object()
        playwright = Mock()
        playwright.chromium.launch = AsyncMock(side_effect=[RuntimeError("is not found"), browser])
        with patch.object(recorder, 'find_chrome', return_value='C:/Users/Test/Chrome/chrome.exe'):
            self.assertIs(await recorder.launch_browser(playwright, headless=True), browser)
        playwright.chromium.launch.assert_awaited_with(executable_path='C:/Users/Test/Chrome/chrome.exe', headless=True)

    async def test_other_errors_do_not_trigger_fallback(self):
        playwright = Mock()
        playwright.chromium.launch = AsyncMock(side_effect=RuntimeError('Operating system failure'))
        with patch.object(recorder, 'find_chrome') as find:
            with self.assertRaisesRegex(RuntimeError, 'Operating system failure'):
                await recorder.launch_browser(playwright, headless=True)
        find.assert_not_called()


if __name__ == '__main__':
    unittest.main()
