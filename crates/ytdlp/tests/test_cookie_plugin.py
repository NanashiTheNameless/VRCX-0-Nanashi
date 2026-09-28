"""Offline compatibility tests against an installed yt-dlp; no real browser cookies."""
import base64
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from yt_dlp import YoutubeDL
from yt_dlp.extractor.youtube import YoutubeIE

source = Path(__file__).parents[1] / 'plugin/yt_dlp_plugins/extractor/nanashi_cookies.py'
spec = importlib.util.spec_from_file_location('nanashi_plugin_test', source)
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


def envelope(path, raw):
    key = bytes(range(32))
    data = bytes(value ^ key[i % 32] for i, value in enumerate(raw.encode()))
    path.write_text(json.dumps({'version': 1, 'key': base64.b64encode(key).decode(),
                               'data': base64.b64encode(data).decode()}))


class CookiePluginTest(unittest.TestCase):
    def test_no_cookie_argument_does_not_read_a_file(self):
        with YoutubeDL({'quiet': True}) as ydl, patch.object(YoutubeIE, '_real_initialize'), patch.object(plugin, '_load') as load:
            plugin.NanashiYoutubeIE(ydl)._real_initialize()
            load.assert_not_called()

    def test_preserves_path_case_and_only_loads_youtube_into_memory(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'Mixed Case Cookies.obf.json'
            envelope(path, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfake-secret\n.other.test\tTRUE\t/\tTRUE\t0\tAUTH\tother-secret\n.youtube.com\tTRUE\t/\tTRUE\t1\tOLD\texpired-secret\n')
            with YoutubeDL({'quiet': True, 'extractor_args': {'youtube': {'nanashi_cookie_file': [str(path)]}}}) as ydl, patch.object(YoutubeIE, '_real_initialize'):
                plugin.NanashiYoutubeIE(ydl)._real_initialize()
                self.assertEqual([(c.name, c.value) for c in ydl.cookiejar], [('SID', 'fake-secret')])
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_corrupt_file_error_does_not_expose_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'cookies.obf.json'
            path.write_text('private-cookie-value')
            with YoutubeDL({'quiet': True, 'extractor_args': {'youtube': {'nanashi_cookie_file': [str(path)]}}}) as ydl:
                with self.assertRaises(Exception) as error:
                    plugin.NanashiYoutubeIE(ydl)._real_initialize()
                self.assertNotIn('private-cookie-value', str(error.exception))
                self.assertIn('refresh cookies', str(error.exception))


if __name__ == '__main__':
    unittest.main()
