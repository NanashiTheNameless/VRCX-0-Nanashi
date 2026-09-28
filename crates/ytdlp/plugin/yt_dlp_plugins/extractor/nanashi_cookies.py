"""Load this profile's obfuscated YouTube cookies directly into yt-dlp's in-memory jar.

No plaintext cookie file is created by the playback plugin. Obfuscation is not encryption.
"""
import base64
import io
import json
from pathlib import Path

from yt_dlp.cookies import YoutubeDLCookieJar
from yt_dlp.extractor.youtube import YoutubeIE
from yt_dlp.utils import ExtractorError

__all__ = []


def _load(path):
    envelope = json.loads(Path(path).read_text(encoding='utf-8'))
    if envelope.get('version') != 1:
        raise ValueError('Unsupported cookie envelope')
    key = base64.b64decode(envelope['key'], validate=True)
    data = base64.b64decode(envelope['data'], validate=True)
    if len(key) != 32 or len(data) > 8 * 1024 * 1024:
        raise ValueError('Invalid cookie envelope')
    text = bytes(v ^ key[i % len(key)] for i, v in enumerate(data)).decode('utf-8')
    jar = YoutubeDLCookieJar(io.StringIO(text))
    # yt-dlp normalizes Netscape expiry 0 to a session cookie after parsing.
    # Loading with ignore_expires=False would discard those session cookies first.
    jar.load(ignore_expires=True)
    for cookie in list(jar):
        if cookie.is_expired():
            jar.clear(cookie.domain, cookie.path, cookie.name)
    return jar


class NanashiYoutubeIE(YoutubeIE, plugin_name='nanashi_cookies'):
    def _real_initialize(self):
        paths = self._configuration_arg('nanashi_cookie_file', [], casesense=True)
        if paths:
            try:
                for cookie in _load(paths[0]):
                    domain = cookie.domain.lstrip('.').lower()
                    if domain == 'youtube.com' or domain.endswith('.youtube.com'):
                        self._downloader.cookiejar.set_cookie(cookie)
            except Exception:
                # Never include cookie values, plaintext, or decoder exception details.
                raise ExtractorError('VRCX cookie file unavailable; refresh cookies in Settings > Media', expected=True) from None
        super()._real_initialize()
