"""Independent, read-only AgencyKey recording pilot. Python 3.12+."""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import math
import random
import os
import re
import shutil
import subprocess
import tempfile
import sys
from contextlib import AsyncExitStack
from datetime import datetime, timezone
from pathlib import Path
from time import monotonic
from urllib.parse import urlparse

RESOURCE_ROOT = Path(__file__).resolve().parent
FROZEN = bool(getattr(sys, 'frozen', False))
DEFAULT_DATA_ROOT = (Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local')
                     / 'HersPruebaDropper') if FROZEN else RESOURCE_ROOT
ROOT = Path(os.environ.get('AGENCYKEY_RECORDER_DATA_DIR', DEFAULT_DATA_ROOT)).expanduser().resolve()
CONFIG = ROOT / 'config.local.json'
STATE = ROOT / 'private' / 'session.json'


def post_id(value: str) -> str:
    value = value.strip()
    if re.fullmatch(r'[1-9][0-9]*', value):
        return value
    match = re.fullmatch(r'https://onlyfans\.com/([1-9][0-9]*)/[^/?#]+/?(?:[?#].*)?', value)
    if not match:
        raise ValueError('Usa un ID numérico o un enlace individual de OnlyFans.')
    return match[1]


def model_profile_url(creator_id) -> str:
    return f'https://app.agencykey.com/models/{int(creator_id)}'


def validate_config(data: dict) -> dict:
    url = urlparse(data.get('profile_url', ''))
    if url.scheme != 'https' or url.netloc != 'app.agencykey.com' or not re.fullmatch(r'/models/[0-9]+/?', url.path) or url.query or url.fragment:
        raise ValueError('El perfil debe ser https://app.agencykey.com/models/ID')
    ids = [post_id(str(value)) for value in data.get('post_ids_newest_first', [])]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError('Añade los IDs sin duplicados, del más reciente al más antiguo.')
    data = dict(data)
    data['post_ids_newest_first'] = ids
    return data


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, indent=2, ensure_ascii=False)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix=path.name + '.', suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def load_config() -> dict:
    if not CONFIG.exists():
        raise ValueError('Ejecuta primero la opción Configurar prueba.')
    return validate_config(json.loads(CONFIG.read_text(encoding='utf-8')))


def configure() -> None:
    print('Se usarán publicaciones existentes. No se enviará contenido a AgencyKey.')
    url = input('URL del perfil en AgencyKey: ').strip()
    print('Pega un enlace o ID por línea, del más reciente al más antiguo. Línea vacía para terminar.')
    ids = []
    while value := input('Post: ').strip():
        ids.append(post_id(value))
    config = validate_config({'profile_url': url, 'post_ids_newest_first': ids})
    save_json(CONFIG, config)
    print(f'Configurados {len(ids)} posts. Video 854×480, recorrido continuo sin pausas fijas.')


def find_chrome() -> str | None:
    if sys.platform == 'win32':
        for variable in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
            base = os.environ.get(variable)
            if base:
                path = Path(base) / 'Google' / 'Chrome' / 'Application' / 'chrome.exe'
                if path.is_file():
                    return str(path)
    return shutil.which('google-chrome') or shutil.which('google-chrome-stable')


async def launch_browser(playwright, *, headless: bool):
    try:
        return await playwright.chromium.launch(channel='chrome', headless=headless)
    except Exception as error:
        if not any(message in str(error) for message in ("Executable doesn't exist", "is not found", "not found at")):
            raise
    executable = find_chrome()
    if executable:
        return await playwright.chromium.launch(executable_path=executable, headless=headless)
    raise ValueError('No se encontró Google Chrome instalado. Instálalo o revisa su ubicación. No se descargó ningún navegador.')


async def check_chrome() -> None:
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await launch_browser(pw, headless=True)
        print(f'Chrome instalado disponible: {browser.version}')
        await browser.close()


async def save_login_session(page, context, profile_url: str, *, state_path: Path | None = None) -> None:
    state = state_path or STATE
    current, expected = urlparse(page.url), urlparse(profile_url)
    if (current.scheme != 'https' or current.netloc != 'app.agencykey.com'
            or current.path.rstrip('/') != expected.path.rstrip('/')):
        raise ValueError('Abre el perfil de la modelo configurada antes de guardar la sesión.')
    # The user has confirmed the profile is open. Virtual feeds may have no post nodes yet.
    state.parent.mkdir(parents=True, exist_ok=True)
    temporary = state.with_suffix('.tmp')
    try:
        await context.storage_state(path=str(temporary), indexed_db=True)
        temporary.chmod(0o600)
        temporary.replace(state)
    finally:
        temporary.unlink(missing_ok=True)


async def login() -> None:
    from playwright.async_api import async_playwright
    config = load_config()
    async with async_playwright() as pw:
        browser = await launch_browser(pw, headless=False)
        context = await browser.new_context(viewport={'width': 1280, 'height': 720})
        try:
            page = await context.new_page()
            await page.goto(config['profile_url'], wait_until='domcontentloaded', timeout=60000)
            await asyncio.to_thread(input, 'Inicia sesión y abre el feed de la modelo. Después pulsa Enter aquí: ')
            while True:
                try:
                    await save_login_session(page, context, config['profile_url'])
                    break
                except ValueError as error:
                    print(str(error))
                    choice = await asyncio.to_thread(input, 'Abre el perfil correcto y pulsa Enter, o escribe C para cancelar: ')
                    if choice.strip().lower() == 'c':
                        return
            print('Sesión guardada en esta PC. Los posts se comprobarán al elegir 3. Grabar prueba local.')
        finally:
            await browser.close()


PROFILE_HEADER = 'main#content .js-compact-sticky-header'
PROFILE_FEED = '.vue-recycle-scroller[page-mode]'
POST_SELECTOR = '[id^="postId_"], [data-post-id]'
POST_ID = r"""e => /^postId_([1-9][0-9]*)$/.exec(e.id)?.[1]
    || (/^[1-9][0-9]*$/.test(e.dataset.postId) ? e.dataset.postId : null)"""


def post_expression(script):
    return script.replace('POST_SELECTOR', POST_SELECTOR).replace('POST_ID', f'({POST_ID})')


# The profile also renders author avatars and icons inside post cards.
MEDIA_HELPERS = r'''
 const inView = e => {
   const r = e.getBoundingClientRect();
   return r.width>0 && r.height>0 && r.bottom>100 && r.top<innerHeight &&
     r.right>0 && r.left<innerWidth && e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
 };
 const photos = (card, minSize=32) => [...card.querySelectorAll('img')].filter(img => {
   const r = img.getBoundingClientRect();
   return r.width>=minSize && r.height>=minSize && inView(img) &&
     !img.closest('[class*="avatar" i], [class*="post__header" i], [class*="post__author" i]');
 });
 const loaded = img => img.complete && img.naturalWidth>0;
 const drm = card => [...card.querySelectorAll('div, p, span, [role="alert"]')].some(e => {
   const text = e.textContent.trim();
   return text.length<250 && /\bDRM\b/i.test(text) &&
     /^(Su navegador no admite este tipo de medios|Your browser (?:does not|doesn't) support this (?:type of )?media|Enable DRM in this browser|Active el DRM en este navegador)/i.test(text) &&
     !e.closest('[class*="post__text" i], [class*="post__caption" i]') && inView(e);
 });
'''

# A recycled feed removes off-screen cards. Read only currently attached nodes.
SNAPSHOT = post_expression(r'''() => {
 MEDIA_HELPERS
 return [...document.querySelectorAll('POST_SELECTOR')].map(e => {
 const r=e.getBoundingClientRect();
 return {id:POST_ID(e),top:r.top,bottom:r.bottom,height:r.height,
 pinned:e.classList.contains('m-pinned'),
 readyImage:photos(e).some(loaded), drmVisible:drm(e),
 visible:r.bottom>100 && r.top<innerHeight && r.right>0 && r.left<innerWidth
  && r.width>0 && r.height>0 && e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})};
 }).filter(p=>p.id && p.visible).sort((a,b)=>a.top-b.top);
}'''.replace('MEDIA_HELPERS', MEDIA_HELPERS))

PENDING_BATCH_PHOTOS = post_expression(r'''ids => {
 MEDIA_HELPERS
 const wanted = new Set(ids);
 return [...document.querySelectorAll('POST_SELECTOR')].filter(card =>
   wanted.has(POST_ID(card)) && !card.classList.contains('m-pinned') && inView(card) &&
   !drm(card) && photos(card, 1).some(img => !loaded(img))).map(POST_ID);
}'''.replace('MEDIA_HELPERS', MEDIA_HELPERS))

RETRY_BATCH_PHOTO = post_expression(r'''id => {
 MEDIA_HELPERS
 const card = [...document.querySelectorAll('POST_SELECTOR')].find(card =>
   POST_ID(card) === id && !card.classList.contains('m-pinned') && inView(card));
 if (!card || drm(card)) return;
 for (const img of photos(card, 1)) {
   if (!img.complete || loaded(img)) continue;
   const source = img.hasAttribute('srcset') ? 'srcset' : 'src';
   if (img.hasAttribute(source)) img.setAttribute(source, img.getAttribute(source));
 }
}'''.replace('MEDIA_HELPERS', MEDIA_HELPERS))

IMAGES_READY = post_expression(r'''() => {
 const cards=[...document.querySelectorAll('POST_SELECTOR')].filter(POST_ID);
 return cards.every(card => {
  const c=card.getBoundingClientRect();
  if(c.bottom<=100 || c.top>=innerHeight || c.right<=0 || c.left>=innerWidth
     || !card.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) return true;
  return [...card.querySelectorAll('img')].every(img => {
   const r=img.getBoundingClientRect();
   if(!r.width || !r.height || r.bottom<=100 || r.top>=innerHeight) return true;
   return img.complete && img.naturalWidth>0;
  });
 });
}''')


async def frame_is_visible(page, frame) -> bool:
    """A card's local rectangle does not tell whether its iframe tab is visible."""
    while frame is not page.main_frame:
        if frame.is_detached() or frame.parent_frame is None:
            return False
        element = await frame.frame_element()
        visible = await element.evaluate(r'''e => {
            const r=e.getBoundingClientRect();
            if(!e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) ||
               r.width<1 || r.height<1 || r.bottom<=0 || r.right<=0 ||
               r.top>=innerHeight || r.left>=innerWidth) return false;
            const x=(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2;
            const y=(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2;
            return document.elementFromPoint(x,y)===e;
        }''')
        if not visible:
            return False
        frame = frame.parent_frame
    return not frame.is_detached()


def frame_matches_model(frame, profile_url):
    if not profile_url:
        return True
    model_id = urlparse(profile_url).path.rstrip('/').rsplit('/', 1)[-1]
    while frame.parent_frame is not None:
        host = urlparse(frame.url).hostname or ''
        if host.startswith('of-') and host.endswith('.agencykey.com') and host != f'of-{model_id}.agencykey.com':
            return False
        frame = frame.parent_frame
    return True


async def post_frame(page, preferred_id=None, *, profile_url=None):
    from playwright.async_api import Error as PlaywrightError

    first = None
    for frame in page.frames:
        if not frame_matches_model(frame, profile_url):
            continue
        try:
            if not await frame_is_visible(page, frame):
                continue
            visible_ids = await frame.locator(POST_SELECTOR).evaluate_all(post_expression(
                """cards => cards.filter(e => e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})
                    && e.getBoundingClientRect().height>0 && e.getBoundingClientRect().right>0).map(POST_ID).filter(Boolean)"""))
        except PlaywrightError as error:
            if frame.is_detached() or 'Execution context was destroyed' in str(error):
                continue
            raise
        if visible_ids:
            first = first or frame
            if preferred_id is None or preferred_id in visible_ids:
                return frame
    return first


async def scroll_frame(page, preferred_id=None, *, profile_url=None):
    found = await post_frame(page, preferred_id, profile_url=profile_url)
    if found:
        return found
    # A profile header can fill a visible iframe before the recycled posts are mounted.
    largest, area = page.main_frame, 0
    for frame in page.frames:
        if not frame_matches_model(frame, profile_url) or not await frame_is_visible(page, frame):
            continue
        if await frame.locator(PROFILE_FEED).first.is_visible():
            return frame
        if frame is page.main_frame:
            continue
        box = await (await frame.frame_element()).bounding_box()
        if box and box['width'] >= 400 and box['height'] >= 250:
            size = box['width'] * box['height']
            if size > area:
                largest, area = frame, size
    if await page.main_frame.locator(PROFILE_HEADER).first.is_visible():
        return page.main_frame
    return largest


async def frame_geometry(page, frame):
    height = await frame.evaluate('innerHeight')
    if frame is page.main_frame:
        return 640, min(460, height - 30), height
    box = await (await frame.frame_element()).bounding_box()
    if not box:
        raise ValueError('El panel de publicaciones ya no está visible. Vuelve a abrir el perfil.')
    outer_height = await page.evaluate('innerHeight')
    visible_height = min(height, outer_height - box['y'])
    if visible_height < 150:
        raise ValueError('El panel de publicaciones no tiene espacio visible suficiente.')
    return box['x'] + box['width'] / 2, max(110, box['y'] + visible_height / 2), visible_height


IMAGE_TIMEOUT_MESSAGE = 'Las imágenes visibles del feed tardaron demasiado en cargar'
PROFILE_LOAD_TIMEOUT_MS = 120_000
FEED_IDLE_TIMEOUT_SECONDS = 180
SLOW_IMAGE_TIMEOUT_MS = 120_000


class RecordingCancelled(ValueError):
    pass


class FirstPostOutOfFrame(ValueError):
    pass


class PhotoWaitControl:
    def __init__(self, notify):
        self.notify = notify
        self.pending_post = None
        self.changed = asyncio.Event()
        self.cancelled = False

    def resume_check(self, *, cancel=False):
        if self.pending_post is None:
            return False
        if cancel:
            self.cancelled = True
        self.changed.set()
        return True

    async def wait(self, frame, ids):
        pending = await frame.evaluate(PENDING_BATCH_PHOTOS, ids)
        if not pending:
            return
        self.pending_post = pending[0]
        try:
            await self.notify(self.pending_post)
            while not self.cancelled:
                pending = await frame.evaluate(PENDING_BATCH_PHOTOS, ids)
                if self.cancelled:
                    break
                if not pending:
                    self.pending_post = None
                    await self.notify(None)
                    return
                if pending[0] != self.pending_post:
                    self.pending_post = pending[0]
                    await self.notify(self.pending_post)
                try:
                    await asyncio.wait_for(self.changed.wait(), 2)
                except TimeoutError:
                    continue
                self.changed.clear()
                if not self.cancelled:
                    await frame.evaluate(RETRY_BATCH_PHOTO, self.pending_post)
            raise RecordingCancelled('Grabación cancelada')
        finally:
            self.pending_post = None


async def images_ready(page, timeout: int = 20000, *, frame=None, photo_ids=None, photo_wait=None) -> None:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError
    frame = frame or page.main_frame
    if photo_ids is not None and not photo_ids:
        return
    try:
        if photo_ids is None:
            await frame.wait_for_function(IMAGES_READY, timeout=timeout)
        else:
            await frame.wait_for_function(f'ids => !({PENDING_BATCH_PHOTOS})(ids).length',
                                          arg=list(photo_ids), timeout=timeout)
    except PlaywrightTimeoutError as error:
        if photo_wait and photo_ids:
            await photo_wait.wait(frame, list(photo_ids))
            return
        raise PlaywrightTimeoutError(IMAGE_TIMEOUT_MESSAGE) from error


async def confirm_start(page, frame, newest: str, *, image_timeout: int = 20_000, reframe=False,
                        photo_ids=None, photo_wait=None) -> dict:
    # The recycled feed can move the target while visible images settle.
    for attempt in range(4 if reframe else 1):
        await images_ready(page, timeout=image_timeout, frame=frame, photo_ids=photo_ids, photo_wait=photo_wait)
        if not await frame_is_visible(page, frame):
            raise ValueError('El primer post está en un panel oculto. No se inició el comprobante.')
        await frame.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        cards = await frame.evaluate(SNAPSHOT)
        target = next((card for card in cards if card['id'] == newest and not card['pinned']), None)
        if target and 95 <= target['top'] <= 145:
            return {'post_id': newest, 'frame_index': page.frames.index(frame),
                    'top': round(target['top'], 2), 'images_ready': True, 'visible': True}
        if not reframe or attempt == 3:
            break
        if target:
            moved = await scroll_down(page, round(target['top'] - 115), frame=frame, anchor=newest, smooth=False)
            if not moved:
                cards = await frame.evaluate(SNAPSHOT)
                target = next((card for card in cards if card['id'] == newest and not card['pinned']), None)
                if not target or not await frame_is_visible(page, frame):
                    continue
                # Short feeds cannot always put a card at 115px. Require its start
                # and enough content inside the actually visible iframe viewport.
                bottom = await frame.evaluate('innerHeight')
                top = 95
                if frame is not page.main_frame:
                    box = await (await frame.frame_element()).bounding_box()
                    if not box:
                        break
                    top = max(top, 95 - box['y'])
                    bottom = min(bottom, await page.evaluate('innerHeight') - box['y'])
                if top <= target['top'] <= bottom - min(120, target.get('height', 120)):
                    return {'post_id': newest, 'frame_index': page.frames.index(frame),
                            'top': round(target['top'], 2), 'images_ready': True, 'visible': True,
                            'alignment': 'scroll_limit'}
        else:
            locator = frame.locator(
                f'[id="postId_{newest}"]:not(.m-pinned):visible, '
                f'[data-post-id="{newest}"]:not(.m-pinned):visible'
            ).first
            from playwright.async_api import TimeoutError as PlaywrightTimeout
            try:
                await locator.scroll_into_view_if_needed(timeout=1500)
            except PlaywrightTimeout:
                pass
    raise FirstPostOutOfFrame(f'El post {newest} ya no está encuadrado en el panel visible. No se inició el comprobante.')


def scroll_steps(pixels: int, *, rng=None) -> list[tuple[int, int]]:
    """Small increments for smooth DOM scrolling."""
    rng = rng or random
    distance = abs(round(pixels))
    if not distance:
        return []
    count = min(distance, max(6, math.ceil(distance / 16)))
    weights = [(1 + .12 * math.sin(math.pi * (i + .5) / count)) * rng.uniform(.96, 1.04) for i in range(count)]
    total = sum(weights)
    sign = 1 if pixels > 0 else -1
    result = []
    accumulated = previous = 0
    for weight in weights:
        accumulated += weight
        position = round(distance * accumulated / total)
        delta = position - previous
        if delta:
            result.append((sign * delta, rng.randint(25, 31)))
        previous = position
    return result


DOM_SCROLL = post_expression(r'''async ({steps, anchor, selectors}) => {
    const displayed = e => e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
    const find = selector => [...document.querySelectorAll(selector)].find(displayed);
    const root = document.scrollingElement;
    const card = [...document.querySelectorAll('POST_SELECTOR')].find(e =>
        displayed(e) && (anchor === POST_ID(e) || (!anchor &&
        e.getBoundingClientRect().bottom > 100 && e.getBoundingClientRect().top < innerHeight)));
    const origin = card || find(selectors.feed) || find(selectors.header) ||
        find('main, [role="main"]');
    const candidates = [];
    for (let node = origin; node; node = node.parentElement) {
        if (node !== root && node.clientHeight > 0 &&
            /^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY)) {
            candidates.push(node);
        }
    }
    if (root) candidates.push(root);
    const distance = steps.reduce((total, [delta]) => total + delta, 0);
    for (const node of candidates) {
        const before = node.scrollTop;
        const destination = Math.max(0, Math.min(before + distance, node.scrollHeight - node.clientHeight));
        if (Math.abs(destination - before) < 1) continue;
        let target = before;
        for (const [delta, pause] of steps) {
            target += delta;
            node.scrollTo({top: target, behavior: 'instant'});
            if (pause) await new Promise(resolve => setTimeout(resolve, pause));
        }
        if (Math.sign(node.scrollTop - before) === Math.sign(distance)) return true;
    }
    return false;
}''')


async def scroll_down(page, pixels: int = 190, *, frame=None, anchor=None, smooth=True) -> bool:
    frame = frame or page.main_frame
    steps = scroll_steps(pixels) if smooth else [(pixels, 0)]
    return await frame.evaluate(DOM_SCROLL, {
        'steps': steps, 'anchor': anchor, 'selectors': {'feed': PROFILE_FEED, 'header': PROFILE_HEADER},
    })


async def seek_start(page, newest: str, timeout: float = 120, *, image_timeout: int = 20_000,
                     profile_url=None, photo_ids=None) -> dict:
    deadline = monotonic() + timeout
    while monotonic() < deadline:
        if profile_url and not same_profile_route(page.url, profile_url):
            raise FeedAccessError('wrong_profile', 'El perfil activo cambió antes de iniciar el comprobante')
        frame = await scroll_frame(page, newest, profile_url=profile_url)
        cards = await frame.evaluate(SNAPSHOT)
        target = next((p for p in cards if p['id'] == newest and not p['pinned']), None)
        if target:
            try:
                await confirm_start(page, frame, newest, image_timeout=image_timeout, reframe=True,
                                    photo_ids=photo_ids)
            except FirstPostOutOfFrame:
                await scroll_down(page, -1_000_000, frame=frame, smooth=False)
                await page.wait_for_timeout(250)
                continue
            target['_frame'] = frame
            return target
        if not await scroll_down(page, 260, frame=frame, smooth=False):
            await page.wait_for_timeout(250)
    raise ValueError(f'El feed abrió, pero no pudo encuadrar el post {newest} del lote')


class FeedAccessError(ValueError):
    def __init__(self, status, message, *, observed=None):
        super().__init__(message)
        self.status = status
        self.observed = observed


async def agencykey_sign_in_visible(page):
    current = urlparse(page.url)
    if current.netloc != 'app.agencykey.com':
        return False
    return (any(part in {'login', 'sign-in', 'signin', 'auth', '2fa', 'mfa'}
                for part in current.path.lower().split('/'))
            or await page.locator('input[type="password"]:visible').first.is_visible())


async def my_profile_visible(page):
    # Profile-specific controls also work when the sidebar has no ARIA selected state.
    edit = re.compile(r'^\s*(?:Editar perfil|Edit profile)\s*$', re.IGNORECASE)
    search = re.compile(r'Buscar (?:la publicación|publicaciones) del usuario|Search (?:user.?s? )?posts', re.IGNORECASE)
    for frame in page.frames:
        if await frame_is_visible(page, frame):
            if (await frame.locator(PROFILE_HEADER).first.is_visible()
                    or await frame.get_by_text(edit).first.is_visible()
                    or await frame.get_by_placeholder(search).first.is_visible()):
                return True
    return False


async def open_my_profile(page, *, profile_url=None):
    """Activate the model's profile from its navigation when available."""
    label = re.compile(r'^\s*(?:Mi perfil|My profile)\s*$', re.IGNORECASE)
    from playwright.async_api import TimeoutError as PlaywrightTimeout
    for frame in page.frames:
        if (profile_url and not frame_matches_model(frame, profile_url)) or not await frame_is_visible(page, frame):
            continue
        matches = frame.get_by_text(label)
        navigation = frame.locator('nav, aside, [role="navigation"]').get_by_text(label)
        for control in [*await navigation.all(), *await matches.all()]:
            if not await control.is_visible():
                continue
            try:
                state = await control.evaluate("""element => {
                const item = element.closest('button, a, [role="button"], [role="tab"], [role="menuitem"]');
                if (!item && !element.closest('nav, aside, [role="navigation"]')
                    && getComputedStyle(element).cursor !== 'pointer') return 'text';
                return element.closest(
                    '[aria-current="page"], [aria-current="true"], [aria-selected="true"], [aria-pressed="true"]'
                ) ? 'selected' : 'available';
                }""", timeout=1500)
                if state == 'text':
                    continue
                if state == 'available':
                    await control.click(timeout=1500)
            except PlaywrightTimeout:
                if await my_profile_visible(page):
                    return True
                continue
            return True
    return False


def transient_frame_error(error):
    return any(message in str(error) for message in
               ('Execution context was destroyed', 'Frame was detached', 'Frame has been detached'))


def same_profile_route(current_url, expected_url):
    current, expected = urlparse(current_url), urlparse(expected_url)
    return (current.scheme, current.netloc, current.path.rstrip('/')) == (
        expected.scheme, expected.netloc, expected.path.rstrip('/'))


def profile_username(value):
    username = (value or '').strip().lstrip('@').casefold()
    return username if re.fullmatch(r'[a-z0-9_]{1,64}', username) else None


def profile_frame_identity(frame):
    url = urlparse(frame.url)
    identity = re.fullmatch(r'of-([0-9]+)\.agencykey\.com', url.hostname or '')
    username = profile_username(url.path.strip('/'))
    if url.scheme == 'https' and identity and username:
        return int(identity[1]), username
    return None


async def visible_model_profiles(page):
    """Read usernames from visible model iframes showing a profile header."""
    profiles = set()
    for frame in page.frames:
        identity = profile_frame_identity(frame)
        if identity and await frame_is_visible(page, frame) and await frame.locator(PROFILE_HEADER).first.is_visible():
            profiles.add(identity)
    return profiles


async def wait_for_model_identity(page, profile_url, username, *, deadline):
    from playwright.async_api import Error as PlaywrightError
    expected = profile_username(username)
    model_id = int(urlparse(profile_url).path.rstrip('/').rsplit('/', 1)[-1])
    on_route = False
    attempts, next_open = 0, 0
    observed = set()
    while (now := monotonic()) < deadline:
        try:
            if await agencykey_sign_in_visible(page):
                raise FeedAccessError('login_required', 'AgencyKey pide iniciar sesión · Reconecta desde el panel web')
            on_route = same_profile_route(page.url, profile_url)
            observed = await visible_model_profiles(page) if on_route else set()
            if expected and observed == {(model_id, expected)}:
                return expected
            if on_route and attempts < 3 and now >= next_open:
                if await open_my_profile(page, profile_url=profile_url):
                    attempts += 1
                next_open = now + 3
        except PlaywrightError as error:
            if page.is_closed() or not transient_frame_error(error):
                raise
        await page.wait_for_timeout(400)
    if len(observed) == 1 and expected:
        _, actual_username = next(iter(observed))
        detail = (f'Se esperaba @{expected} y se abrió @{actual_username}.'
                  if actual_username != expected else 'Chrome abrió el espacio de trabajo de otra modelo.')
        raise FeedAccessError('wrong_profile', detail, observed=actual_username)
    if not on_route:
        raise FeedAccessError('wrong_profile', 'Chrome no abrió la ruta de la modelo seleccionada')
    raise FeedAccessError('profile_unverified', 'No se pudo verificar el perfil de la modelo seleccionada')


async def wait_for_feed(page, profile_url, *, deadline, preferred_id=None):
    """Mount the feed by scrolling the visible profile content."""
    expected = urlparse(profile_url) if profile_url else None
    from playwright.async_api import Error as PlaywrightError

    on_route = profile_opened = False
    while monotonic() < deadline:
        try:
            if await agencykey_sign_in_visible(page):
                raise FeedAccessError('login_required', 'AgencyKey pide iniciar sesión · Reconecta desde el panel web')
            on_route = not expected or same_profile_route(page.url, profile_url)
            if on_route:
                frame = await post_frame(page, preferred_id, profile_url=profile_url)
                if frame:
                    return frame
                if expected and not profile_opened:
                    if await my_profile_visible(page):
                        profile_opened = True
                    elif await open_my_profile(page):
                        profile_opened = True
                        await page.wait_for_timeout(700)
                        continue
                await scroll_down(page, 340, frame=await scroll_frame(page, profile_url=profile_url), smooth=False)
        except PlaywrightError as error:
            if page.is_closed() or not transient_frame_error(error):
                raise
        await page.wait_for_timeout(500)
    if expected and not on_route:
        raise FeedAccessError('wrong_profile', 'Chrome no abrió la ruta de la modelo seleccionada')
    if expected and not profile_opened:
        raise FeedAccessError('profile_menu_missing', 'Chrome abrió la modelo, pero no encontró Mi perfil')
    target = f' Se buscaba el post {preferred_id}.' if preferred_id else ''
    raise FeedAccessError('feed_unverified', f'Mi perfil abrió, pero el feed no mostró publicaciones reconocibles.{target}')


async def prepare_feed(page, ids, *, timeout=600, profile_url=None, photo_ids=None):
    """Wait for the first post. The recording verifies the rest as it scrolls."""
    deadline = monotonic() + timeout
    seek_timeout = FEED_IDLE_TIMEOUT_SECONDS if profile_url else 30
    await wait_for_feed(page, profile_url, deadline=min(deadline, monotonic() + seek_timeout),
                        preferred_id=ids[0])
    options = {'image_timeout': SLOW_IMAGE_TIMEOUT_MS, 'profile_url': profile_url} if profile_url else {}
    if photo_ids is not None:
        options['photo_ids'] = photo_ids
    return await seek_start(page, ids[0], timeout=max(.1, min(seek_timeout, deadline - monotonic())), **options)


async def mask_other_posts(frame, ids):
    # Keep the positions of virtualized cards while omitting them from every frame.
    allowed = ', '.join(f'[id="postId_{pid}"], :not([id^="postId_"])[data-post-id="{pid}"]' for pid in ids)
    await frame.evaluate('''async css => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }''', f':is({POST_SELECTOR}):is(.m-pinned, :not(:is({allowed}))) '
          '{ opacity: 0 !important; pointer-events: none !important; }')


async def capture_walk(page, ids: list[str], dwell: float = 0, timeout: float = 600, *,
                       frame=None, seen=None, on_progress=None, reset_on_progress=False,
                       image_timeout: int = 20_000, profile_url=None, capture=None, photo_ids=None,
                       photo_wait=None, protected_photos=None) -> list[str]:
    frame = frame or await post_frame(page) or page.main_frame
    seen = [] if seen is None else seen
    deadline = monotonic() + timeout
    photographed = set()
    expected_photos = set(photo_ids or ())
    protected_photos = protected_photos if protected_photos is not None else set()
    while monotonic() < deadline:
        if capture:
            capture.accepting = False
        if profile_url and (not same_profile_route(page.url, profile_url)
                            or not frame_matches_model(frame, profile_url)):
            raise FeedAccessError('wrong_profile', 'El perfil activo cambió durante el comprobante')
        if frame.is_detached():
            raise ValueError('El panel de publicaciones se recargó. Repite únicamente la grabación.')
        if not await frame_is_visible(page, frame):
            raise ValueError('El panel de publicaciones quedó oculto durante el recorrido. Repite la grabación.')
        waiting_since = monotonic() if photo_wait else None
        await images_ready(page, timeout=image_timeout, frame=frame,
                           photo_ids=ids if photo_ids is None else photo_ids, photo_wait=photo_wait)
        if waiting_since is not None:
            deadline += monotonic() - waiting_since
        _, _, height = await frame_geometry(page, frame)
        cards = [card for card in await frame.evaluate(SNAPSHOT) if card['id'] in ids and not card['pinned']]
        if capture and cards:
            await capture.checkpoint()
            capture.accepting = True
        for card in cards:
            if card['id'] in expected_photos:
                if card.get('drmVisible'):
                    protected_photos.add(card['id'])
                elif card.get('readyImage'):
                    photographed.add(card['id'])
        for card in cards:
            if card['id'] in seen or not (100 <= card['top'] < height - 40):
                continue
            expected = ids[len(seen)]
            if card['id'] != expected:
                raise ValueError(f'Orden inesperado o post omitido: se esperaba {expected}, apareció {card["id"]}.')
            seen.append(card['id'])
            if on_progress:
                on_progress({'stage': 'grabando', 'completed': len(seen), 'total': len(ids), 'post_id': card['id']})
            print(f'Grabando {len(seen)}/{len(ids)} · ID {card["id"]}', flush=True)
            await page.wait_for_timeout(dwell * 1000)
            if reset_on_progress:
                deadline = monotonic() + timeout
        last = next((p for p in cards if p['id'] == ids[-1]), None)
        if last and 100 < last['bottom'] <= height - 20 and seen == ids:
            if missing_photos := expected_photos - photographed - protected_photos:
                raise ValueError('No se comprobaron las fotos de los posts: ' + ', '.join(sorted(missing_photos)))
            await page.wait_for_timeout(dwell * 1000)
            return seen
        if capture:
            capture.accepting = False
        if not await scroll_down(page, frame=frame):
            await page.wait_for_timeout(250)
    remaining = next((pid for pid in ids if pid not in seen), None)
    reason = f'Falta localizar el post {remaining}.' if remaining else f'No se pudo encuadrar el final del post {ids[-1]}.'
    raise ValueError(f'Recorrido incompleto: {len(seen)}/{len(ids)} posts. {reason}')


def ffmpeg_path() -> str:
    if FROZEN:
        path = RESOURCE_ROOT / 'encoder' / 'ffmpeg.exe'
        if not path.is_file():
            raise ValueError('Falta el codificador incluido. Vuelve a descargar el EXE completo.')
        return str(path)
    found = shutil.which('ffmpeg') if not FROZEN else None
    if found:
        return found
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


class TabCapture:
    """Save only frames captured between the verified start and end of the Drop."""

    def __init__(self, folder: Path):
        self.folder = folder
        self.frames: list[tuple[float, str]] = []
        self.checkpoints: set[str] = set()
        self.pending: set[asyncio.Task] = set()
        self.session = None
        self.accepting = False
        self.failure: Exception | None = None

    def save_frame(self, data: str) -> None:
        name = f'frame-{len(self.frames):07}.jpg'
        (self.folder / name).write_bytes(base64.b64decode(data, validate=True))
        self.frames.append((monotonic(), name))

    async def acknowledge(self, session_id: int) -> None:
        try:
            await self.session.send('Page.screencastFrameAck', {'sessionId': session_id})
        except Exception as error:
            if self.accepting:
                self.failure = error

    def receive(self, event: dict) -> None:
        if self.accepting and self.failure is None:
            try:
                self.save_frame(event['data'])
            except Exception as error:
                self.failure = error
        task = asyncio.create_task(self.acknowledge(event['sessionId']))
        self.pending.add(task)
        task.add_done_callback(self.pending.discard)

    async def checkpoint(self) -> None:
        # A still tab may emit no screencast event. Request the current frame explicitly.
        async with asyncio.timeout(15):
            result = await self.session.send('Page.captureScreenshot', {'format': 'jpeg', 'quality': 80})
        self.save_frame(result['data'])
        self.checkpoints.add(self.frames[-1][1])

    async def start(self, page) -> None:
        self.folder.mkdir()
        self.session = await page.context.new_cdp_session(page)
        async with asyncio.timeout(15):
            await self.checkpoint()
            self.session.on('Page.screencastFrame', self.receive)
            self.accepting = True
            await self.session.send('Page.startScreencast', {
                'format': 'jpeg', 'quality': 80, 'maxWidth': 1280, 'maxHeight': 720,
                'everyNthFrame': 1,
            })

    async def finish(self) -> None:
        self.accepting = False
        async with asyncio.timeout(15):
            await self.session.send('Page.stopScreencast')
            await self.checkpoint()
        if self.failure:
            raise ValueError('Chrome no pudo guardar el recorrido completo.') from self.failure

    async def close(self) -> None:
        if self.session is None:
            return
        self.accepting = False
        if self.pending:
            try:
                async with asyncio.timeout(5):
                    await asyncio.gather(*self.pending, return_exceptions=True)
            except TimeoutError:
                pass
        try:
            await self.session.detach()
        except Exception:
            # The desktop stop command may have already closed the tab.
            pass
        self.session = None

    def encode(self, target: Path) -> float:
        manifest = self.folder / 'frames.ffconcat'
        holds = [min(.45, max(.10 if current[1] in self.checkpoints else .001, following[0] - current[0]))
                 for current, following in zip(self.frames, self.frames[1:])] + [.30]
        duration = sum(holds)
        with manifest.open('w', encoding='ascii') as stream:
            stream.write('ffconcat version 1.0\n')
            for (_, name), hold in zip(self.frames, holds):
                stream.write(f"file '{name}'\nduration {hold:.6f}\n")
            stream.write(f"file '{self.frames[-1][1]}'\n")
        command = [ffmpeg_path(), '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-i', str(manifest),
                   '-t', f'{duration:.3f}', '-an', '-vf', 'fps=20,scale=854:480', '-c:v', 'libx264', '-preset', 'fast', '-crf', '24',
                   '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(target)]
        subprocess.run(command, check=True, capture_output=True)
        if not target.exists() or target.stat().st_size < 1000:
            raise ValueError('No se pudo generar un video válido.')
        return duration


async def failure_diagnostics(page) -> list[dict]:
    """Only collect geometry and load state; omit URLs, text and session data."""
    result = []
    for index, frame in enumerate(page.frames):
        if frame.is_detached():
            continue
        try:
            cards = await frame.evaluate(SNAPSHOT)
            images = await frame.evaluate(post_expression(r'''() => [...document.querySelectorAll('POST_SELECTOR')].filter(POST_ID)
                .flatMap(card => [...card.querySelectorAll('img')].map(img => ({img,card})))
                .filter(({img}) => { const r=img.getBoundingClientRect();
                    return r.width>0 && r.height>0 && r.bottom>100 && r.top<innerHeight; })
                .map(({img,card}) => ({post_id:POST_ID(card),
                    complete:img.complete, loaded:img.naturalWidth>0}))'''))
            result.append({'frame_index': index, 'visible': await frame_is_visible(page, frame),
                           'cards': cards, 'images': images})
        except Exception:
            result.append({'frame_index': index, 'unavailable': True})
    return result


async def pause_failed_test(page) -> None:
    if page.is_closed():
        return
    print('Chrome queda abierto en el punto del fallo para revisarlo.', flush=True)
    try:
        await asyncio.to_thread(input, 'Pulsa Enter en esta consola para cerrar Chrome: ')
    except EOFError:
        pass


def recording_error_detail(error, *, page_closed=False):
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    if isinstance(error, ValueError) and str(error):
        return str(error)
    if page_closed:
        return 'Chrome se cerró durante la grabación.'
    if isinstance(error, PlaywrightTimeoutError):
        return IMAGE_TIMEOUT_MESSAGE if str(error) == IMAGE_TIMEOUT_MESSAGE else 'Chrome agotó el tiempo de espera.'
    browser_errors = {
        'ERR_NAME_NOT_RESOLVED': 'Chrome no pudo resolver la dirección de AgencyKey.',
        'ERR_INTERNET_DISCONNECTED': 'Chrome detectó que la PC perdió la conexión a Internet.',
        'ERR_NETWORK_CHANGED': 'La red cambió mientras Chrome cargaba AgencyKey.',
        'ERR_CONNECTION_RESET': 'Se restableció la conexión con AgencyKey durante la carga.',
        'ERR_CONNECTION_CLOSED': 'Se cerró la conexión con AgencyKey durante la carga.',
        'ERR_TIMED_OUT': 'La conexión con AgencyKey agotó el tiempo de espera.',
        'ERR_CERT_': 'Chrome rechazó el certificado de AgencyKey.',
    }
    for code, detail in browser_errors.items():
        if code in str(error):
            return detail
    if isinstance(error, OSError):
        return f'Windows no pudo acceder a un archivo o recurso ({type(error).__name__}).'
    return f'Error inesperado ({type(error).__name__}).'


async def open_recording_page(stack, *, headless, storage_state=None):
    from playwright.async_api import async_playwright
    playwright = await stack.enter_async_context(async_playwright())
    browser = await launch_browser(playwright, headless=headless)
    stack.push_async_callback(browser.close)
    options = {'viewport': {'width': 1280, 'height': 720}}
    if storage_state is not None:
        options['storage_state'] = storage_state
    context = await browser.new_context(**options)
    stack.push_async_callback(context.close)
    return await context.new_page(), context


async def navigate_recording_page(page, url, *, fixture=None, stop_event=None, stage=None):
    from playwright.async_api import Error as BrowserError, TimeoutError as BrowserTimeout
    navigation_timeout = 45_000 if fixture else PROFILE_LOAD_TIMEOUT_MS
    while True:
        if stop_event and stop_event.is_set():
            raise asyncio.CancelledError
        try:
            response = await page.goto(url, wait_until='domcontentloaded', timeout=navigation_timeout)
            if fixture or response is None or response.status < 500:
                break
        except BrowserError as error:
            transient = ('ERR_NETWORK_CHANGED', 'ERR_INTERNET_DISCONNECTED', 'ERR_CONNECTION_RESET',
                         'ERR_TIMED_OUT', 'ERR_CONNECTION_CLOSED', 'ERR_NAME_NOT_RESOLVED')
            retryable = isinstance(error, BrowserTimeout) or any(code in str(error) for code in transient)
            if fixture or page.is_closed() or (stop_event and stop_event.is_set()) or not retryable:
                raise
        if stage:
            stage('reintentando abrir el perfil por un fallo de conexión')
        await page.wait_for_timeout(2000)

    if not fixture and response is not None:
        if response.status == 401:
            raise ValueError('AgencyKey pide iniciar sesión · Reconecta desde la web')
        if response.status in (403, 404):
            raise ValueError('AgencyKey no permite abrir las publicaciones de esta modelo. Revisa sus permisos en el panel web.')


async def recover_model_profile(page, url, username, *, stop_event=None, stage=None):
    while True:
        if stop_event and stop_event.is_set():
            raise asyncio.CancelledError
        try:
            return await wait_for_model_identity(page, url, username, deadline=monotonic() + 35)
        except FeedAccessError as error:
            if error.status != 'profile_unverified' or page.is_closed():
                raise
        if stage:
            stage('reintentando abrir el perfil por un fallo de conexión')
        await page.wait_for_timeout(2000)
        await navigate_recording_page(page, url, stop_event=stop_event, stage=stage)



async def page_has_post(page, url, post_id):
    from playwright.async_api import Error as PlaywrightError
    if not same_profile_route(page.url, url):
        return False
    try:
        frame = await post_frame(page, post_id, profile_url=url)
        return frame is not None and any(
            card['id'] == post_id and not card['pinned'] for card in await frame.evaluate(SNAPSHOT)
        )
    except PlaywrightError as error:
        if transient_frame_error(error):
            return False
        raise


async def record(config: dict, *, fixture: Path | None = None, headless: bool = False, dwell: float = 0,
                 session_path: Path | None = None, on_progress=None, on_preview=None, stop_event=None,
                 session_state=None, on_session_saved=None, on_browser_failure=None, prepared_page=None,
                 photo_wait=None) -> Path:
    state = session_path or STATE
    if not fixture and session_state is None and not state.exists():
        raise ValueError('Conecta la sesión compartida de AgencyKey desde la web.')
    run_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + __import__('uuid').uuid4().hex[:6]
    output = ROOT / 'output' / run_id
    output.mkdir(parents=True)
    report_path = output / 'report.json'
    report = {'status': 'incomplete', 'simulation': bool(fixture), 'post_ids': config['post_ids_newest_first'],
              'profile_url': config['profile_url'], 'resolution': '854x480', 'seen': [], 'created_at_utc': run_id,
              'first_post_id': config['post_ids_newest_first'][0], 'headless': headless, 'post_hold_seconds': dwell}
    save_json(report_path, report)
    capture = TabCapture(output / 'raw')
    image_ids = config.get('photo_post_ids')
    protected_photos = set()
    error = None
    def stage(value):
        report['stage'] = value
        if on_progress:
            on_progress({'stage': value, 'completed': len(report['seen']), 'total': len(report['post_ids'])})

    async with AsyncExitStack() as stack:
        if prepared_page is None:
            stage('iniciando Chrome')
            storage = None if fixture else (session_state if session_state is not None else str(state))
            page, context = await open_recording_page(stack, headless=headless, storage_state=storage)
        else:
            page, context = prepared_page
        async def monitor():
            while not page.is_closed():
                if stop_event and stop_event.is_set():
                    await page.close()
                    return
                if on_preview:
                    try:
                        on_preview(await page.screenshot(type='png', timeout=2000))
                    except Exception:
                        pass
                await asyncio.sleep(1.5)
        monitor_task = asyncio.create_task(monitor())
        try:
            stage('abrir perfil')
            print('Etapa: abrir perfil', flush=True)
            url = fixture.resolve().as_uri() if fixture else config['profile_url']
            if prepared_page is None or not await page_has_post(page, url, report['first_post_id']):
                await navigate_recording_page(page, url, fixture=fixture, stop_event=stop_event, stage=stage)
            if not fixture and 'creator_username' in config:
                stage('verificando identidad de la modelo')
                verified_username = await recover_model_profile(
                    page, url, config['creator_username'], stop_event=stop_event, stage=stage)
            else:
                verified_username = None
            stage('cargando feed e imágenes')
            print(f'Etapa: {report["stage"]} · ID {report["first_post_id"]}', flush=True)
            start_limit = 45 if fixture else FEED_IDLE_TIMEOUT_SECONDS
            try:
                async with asyncio.timeout(start_limit if fixture else None):
                    first = await prepare_feed(page, config['post_ids_newest_first'], timeout=start_limit,
                                               profile_url=None if fixture else url, photo_ids=())
            except TimeoutError as exc:
                raise ValueError(f'Se agotó la búsqueda del primer post {report["first_post_id"]}.') from exc
            print(f'Inicio del comprobante: post {config["post_ids_newest_first"][0]} · segundo plano: {headless}', flush=True)
            stage('marcar inicio del video')
            for attempt in range(2):
                if not fixture and (not same_profile_route(page.url, url)
                                    or not frame_matches_model(first['_frame'], url)):
                    raise FeedAccessError('wrong_profile', 'El perfil activo cambió antes de iniciar el comprobante')
                if verified_username:
                    identity = profile_frame_identity(first['_frame'])
                    if not identity or identity[1] != verified_username:
                        raise FeedAccessError('wrong_profile', 'El panel del primer post pertenece a otro perfil')
                try:
                    report['start_verified'] = await confirm_start(
                        page, first['_frame'], report['first_post_id'], reframe=True,
                        photo_ids=report['post_ids'] if image_ids is None else image_ids, photo_wait=photo_wait,
                        **({} if fixture else {'image_timeout': SLOW_IMAGE_TIMEOUT_MS}))
                    break
                except FirstPostOutOfFrame:
                    if attempt:
                        raise
                    await scroll_down(page, -1_000_000, frame=first['_frame'], smooth=False)
                    first = await prepare_feed(page, report['post_ids'], timeout=start_limit,
                                               profile_url=None if fixture else url, photo_ids=())
            await mask_other_posts(first['_frame'], report['post_ids'])
            await capture.start(page)
            stage('recorrer posts / cargar imágenes')
            walk_limit = 30 if fixture else FEED_IDLE_TIMEOUT_SECONDS
            try:
                async with asyncio.timeout(walk_limit if fixture else None):
                    await capture_walk(page, config['post_ids_newest_first'], dwell=dwell, timeout=walk_limit,
                                       frame=first['_frame'], seen=report['seen'], on_progress=on_progress,
                                       capture=capture, photo_ids=image_ids, photo_wait=photo_wait,
                                       protected_photos=protected_photos,
                                       **({} if fixture else {'reset_on_progress': True,
                                                              'image_timeout': SLOW_IMAGE_TIMEOUT_MS,
                                                              'profile_url': url}))
            except TimeoutError as exc:
                raise ValueError(f'Se agotó la grabación tras comprobar {len(report["seen"])}/{len(report["post_ids"])} posts.') from exc
            await page.wait_for_timeout(120)
            stage('marcar fin del video')
            await capture.finish()
            if len(report['post_ids']) > 1 and len(capture.frames) <= 2:
                raise ValueError('Chrome no entregó fotogramas durante el recorrido.')
        except Exception as exc:
            await capture.close()
            error = exc
            report['error_type'] = type(exc).__name__
            if stop_event and stop_event.is_set():
                exc = ValueError('Grabación detenida · Pulsa Reintentar para volver a grabar el comprobante')
                error = exc
                report['error_type'] = 'RecordingStopped'
            if isinstance(exc, FeedAccessError):
                report['error_code'] = exc.status
            reason = recording_error_detail(exc, page_closed=page.is_closed())
            report['next_post_id'] = next((pid for pid in report['post_ids'] if pid not in report['seen']), None)
            if report['stage'] in {'cargando feed e imágenes', 'marcar inicio del video',
                                   'recorrer posts / cargar imágenes'} and report['next_post_id']:
                if not isinstance(exc, FeedAccessError) and not isinstance(exc, ValueError):
                    reason += f' Siguiente post del lote: {report["next_post_id"]}.'
            report['error'] = f'Etapa: {report["stage"]}. {reason}'
            if not isinstance(exc, RecordingCancelled):
                try:
                    async with asyncio.timeout(5):
                        report['diagnostics'] = await failure_diagnostics(page)
                except TimeoutError:
                    report['diagnostics'] = []
            save_json(report_path, report)
            if not isinstance(exc, RecordingCancelled):
                from diagnostics import capture_failure
                await capture_failure(page, kind='grabacion', profile_url=config['profile_url'],
                                      username=config.get('creator_username'), error=exc,
                                      status=report.get('error_code'), post_ids=report['post_ids'], stage=report['stage'])
            print(f'{report["error"]}\nPosts comprobados: {len(report["seen"])}/{len(report["post_ids"])}'
                  f' · siguiente ID: {report["next_post_id"]}\nInforme: {report_path}', flush=True)
            if not headless and not fixture and not page.is_closed() and not (stop_event and stop_event.is_set()):
                if on_browser_failure:
                    await on_browser_failure(page, report['stage'], reason)
                else:
                    await pause_failed_test(page)
        finally:
            await capture.close()
            monitor_task.cancel()
            try:
                await monitor_task
            except asyncio.CancelledError:
                pass
            if not fixture and error is None:
                try:
                    if session_state is not None:
                        if on_session_saved:
                            await on_session_saved(await context.storage_state(indexed_db=True))
                    else:
                        await save_login_session(page, context, config['profile_url'], state_path=state)
                    report['session_refreshed'] = True
                except Exception as refresh_error:
                    report['session_refresh_error'] = type(refresh_error).__name__
                    if on_progress:
                        on_progress({'stage': 'Aviso: no se pudo actualizar la sesión guardada',
                                     'completed': len(report['seen']), 'total': len(report['post_ids'])})
    try:
        if isinstance(error, RecordingCancelled):
            raise error
        if error:
            raise ValueError(report['error']) from error
        if report['seen'] != report['post_ids']:
            raise ValueError('No se capturaron todos los posts del comprobante.')
        stage('convertir video a MP4')
        video = output / 'comprobante.mp4'
        duration = await asyncio.to_thread(capture.encode, video)
        report.update(status='complete', capture_validation=2, stage='completo', duration_seconds=round(duration, 2),
                      bytes=video.stat().st_size, sha256=hashlib.sha256(video.read_bytes()).hexdigest(),
                      video='comprobante.mp4',
                      drm_photo_ids=[pid for pid in report['post_ids'] if pid in protected_photos])
        if on_progress:
            on_progress({'stage': 'video listo', 'completed': len(report['seen']), 'total': len(report['post_ids'])})
        print(f'Video completo: {video}\nTamaño: {video.stat().st_size / 1_000_000:.2f} MB')
        return report_path
    except Exception as exc:
        report.setdefault('error_type', type(exc).__name__)
        report.setdefault('error', recording_error_detail(exc))
        raise
    finally:
        save_json(report_path, report)
        # Never retain setup/login navigation or incomplete captures.
        if capture.folder.exists():
            shutil.rmtree(capture.folder)


def has_capture_validation(report_path: Path) -> bool:
    try:
        return json.loads(report_path.read_text(encoding='utf-8')).get('capture_validation') == 2
    except (OSError, ValueError):
        return False


def verified_video(report_path: Path) -> tuple[dict, Path]:
    report = json.loads(report_path.read_text(encoding='utf-8'))
    if report.get('status') != 'complete' or report.get('seen') != report.get('post_ids'):
        raise ValueError('El comprobante no está completo.')
    video = report_path.parent / 'comprobante.mp4'
    if hashlib.sha256(video.read_bytes()).hexdigest() != report.get('sha256'):
        raise ValueError('El video cambió después de la grabación.')
    if video.stat().st_size > 49_000_000:
        raise ValueError('El video supera el límite conservador de 49 MB; no se enviará.')
    return report, video


TOKEN_DIALOG_SCRIPT = r"""
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Dropper - Telegram'
$form.ClientSize = New-Object System.Drawing.Size(470,155)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Pega el token del BOT DE PRUEBAS con Ctrl+V. No se guarda.'
$label.SetBounds(15,15,440,30)
$entry = New-Object System.Windows.Forms.TextBox
$entry.SetBounds(15,50,440,26)
$entry.UseSystemPasswordChar = $true
$entry.ShortcutsEnabled = $true
$ok = New-Object System.Windows.Forms.Button
$ok.Text = 'Usar token'
$ok.SetBounds(235,100,105,30)
$ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'Cancelar'
$cancel.SetBounds(350,100,105,30)
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.AddRange(@($label,$entry,$ok,$cancel))
$form.AcceptButton = $ok
$form.CancelButton = $cancel
$form.Add_Shown({[void]$entry.Focus()})
try {
    $result = $form.ShowDialog()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::Out.Write($entry.Text.Trim())
    } else { exit 2 }
} finally { $entry.Clear(); $form.Dispose() }
"""


def read_bot_token() -> str:
    if sys.platform != 'win32':
        from getpass import getpass
        return getpass('Token del BOT DE PRUEBAS (oculto, no se guarda): ').strip()
    powershell = shutil.which('powershell.exe')
    if not powershell:
        raise ValueError('No se encontró Windows PowerShell para abrir el campo de token.')
    result = subprocess.run([powershell, '-NoProfile', '-STA', '-Command', TOKEN_DIALOG_SCRIPT],
                            capture_output=True, text=True, encoding='utf-8',
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode == 2:
        raise ValueError('Envío cancelado.')
    if result.returncode:
        raise ValueError('No se pudo abrir el campo de token de Telegram.')
    return result.stdout.strip()


async def send(report_path: Path) -> None:
    import httpx
    from recorder_network import TelegramFailure, telegram_connection_options, telegram_request
    report, video = verified_video(report_path)
    if report.get('telegram', {}).get('message_id'):
        raise ValueError('Este comprobante ya tiene un envío confirmado en Telegram.')
    previous = report.get('telegram_attempt', {}).get('status')
    if previous in {'sending', 'delivery_unknown'}:
        if input('El envío anterior no está confirmado. Revisa el chat; escribe REENVIAR solo si no llegó: ').strip() != 'REENVIAR':
            raise ValueError('Reenvío cancelado.')
    token = read_bot_token()
    if not re.fullmatch(r'[0-9]+:[A-Za-z0-9_-]+', token):
        raise ValueError('Formato de token inválido.')
    options = telegram_connection_options()
    async with httpx.AsyncClient(base_url=f'https://api.telegram.org/bot{token}/',
                                 timeout=httpx.Timeout(180, connect=30, pool=30),
                                 follow_redirects=False, **options) as client:
        async def api(method, **kwargs):
            print(f'Telegram · {method}', flush=True)
            try:
                return await telegram_request(client, method, **kwargs)
            except TelegramFailure as error:
                report['telegram_attempt'] = {'status': 'delivery_unknown' if error.uncertain else 'failed',
                                              'method': error.method, 'category': error.category}
                save_json(report_path, report)
                raise
        me = await api('getMe')
        username = me.get('username', '')
        print(f'Bot de destino: @{username}')
        if input('Confirma que es tu bot de pruebas escribiendo su usuario sin @: ').strip() != username:
            raise ValueError('Envío cancelado.')
        webhook = await api('getWebhookInfo')
        if webhook.get('url'):
            raise ValueError('Este bot tiene un webhook activo. Usa uno de pruebas sin otro proceso activo.')
        code = 'recorder-' + __import__('secrets').token_hex(4)
        print(f'Envía este texto exacto al bot, en tu chat privado: {code}')
        input('Después pulsa Enter aquí: ')
        updates = await api('getUpdates', json={'timeout': 0, 'limit': 100})
        chats = {u['message']['chat']['id'] for u in updates if u.get('message', {}).get('text') == code
                 and u['message']['chat']['type'] == 'private'}
        if len(chats) != 1:
            raise ValueError('No se encontró un único chat con el código. No se envió nada.')
        chat_id = chats.pop()
        caption = ('SIMULACIÓN · ' if report.get('simulation') else '') + f'Comprobante de prueba · {len(report["seen"])} posts · 480p'
        report['telegram_attempt'] = {'status': 'sending', 'method': 'sendVideo', 'chat_id': chat_id}
        save_json(report_path, report)
        with video.open('rb') as stream:
            result = await api('sendVideo', data={'chat_id': str(chat_id), 'caption': caption,
                                                  'supports_streaming': 'true'},
                               files={'video': ('comprobante.mp4', stream, 'video/mp4')})
        report['telegram'] = {'chat_id': chat_id, 'message_id': result['message_id']}
        report['telegram_attempt'] = {'status': 'sent', 'method': 'sendVideo'}
        save_json(report_path, report)
        print('Video enviado al chat del bot de pruebas.')


def latest_report() -> Path:
    reports = sorted((ROOT / 'output').glob('*/report.json'))
    if not reports:
        raise ValueError('Todavía no hay grabaciones.')
    return reports[-1]


def menu(*, headless: bool = False) -> None:
    print(f'Chrome instalado · navegador {"oculto" if headless else "visible"} · movimiento continuo.')
    print(f'Carpeta de datos y videos: {ROOT}')
    while True:
        print('\nDropper · grabador independiente\n'
              '1. Configurar posts existentes\n2. Conectar AgencyKey\n3. Grabar prueba local\n'
              '4. Enviar último video al bot de pruebas\n5. Generar demo sin AgencyKey\n0. Salir')
        choice = input('Opción: ').strip()
        try:
            if choice == '0':
                return
            if choice == '1':
                configure()
            elif choice == '2':
                asyncio.run(login())
            elif choice == '3':
                asyncio.run(record(load_config(), headless=headless))
            elif choice == '4':
                asyncio.run(send(latest_report()))
            elif choice == '5':
                asyncio.run(record({'profile_url': 'SIMULACIÓN', 'post_ids_newest_first': ['200', '100']},
                                   fixture=RESOURCE_ROOT / 'tests' / 'feed.html', headless=headless))
        except KeyboardInterrupt:
            print('\nOperación interrumpida.')
        except Exception as exc:
            # Third-party exceptions can contain request URLs; never echo them.
            detail = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
            print(f'No se completó la operación: {detail}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', nargs='?', default='menu', choices=['menu', 'configure', 'login', 'record', 'send', 'demo', 'check-chrome'])
    parser.add_argument('--report', type=Path)
    visibility = parser.add_mutually_exclusive_group()
    visibility.add_argument('--headless', action='store_true', help='Grabar sin ventana explícitamente.')
    visibility.add_argument('--show-browser', action='store_true', help='Mostrar Chrome durante una prueba (predeterminado).')
    parser.add_argument('--check-token-input', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--check-telegram-support', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.check_telegram_support:
        from recorder_network import check_telegram_support
        asyncio.run(check_telegram_support())
        return
    if args.check_token_input:
        token = read_bot_token()
        if not re.fullmatch(r'[0-9]+:[A-Za-z0-9_-]+', token):
            raise ValueError('Formato de token inválido.')
        print('Token recibido correctamente (oculto).')
        return
    if args.command == 'check-chrome':
        asyncio.run(check_chrome())
    elif args.command == 'menu':
        menu(headless=args.headless)
    elif args.command == 'configure':
        configure()
    elif args.command == 'login':
        asyncio.run(login())
    elif args.command == 'record':
        asyncio.run(record(load_config(), headless=args.headless))
    elif args.command == 'send':
        asyncio.run(send(args.report or latest_report()))
    elif args.command == 'demo':
        asyncio.run(record({'profile_url': 'SIMULACIÓN', 'post_ids_newest_first': ['200', '100']},
                           fixture=RESOURCE_ROOT / 'tests' / 'feed.html', headless=args.headless))


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('Interrumpido.')
        sys.exit(130)
    except Exception as exc:
        detail = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
        print(f'Error: {detail}', file=sys.stderr)
        if FROZEN and len(sys.argv) == 1:
            input('Pulsa Enter para cerrar: ')
        sys.exit(1)
