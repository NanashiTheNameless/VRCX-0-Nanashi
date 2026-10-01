#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile


def checksum(path):
    with path.open('rb') as image:
        return hashlib.file_digest(image, 'sha256').hexdigest()


def launch(image, expected, environment):
    with subprocess.Popen(
        [str(image), '--appimage-smoke-test'], env=environment,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True,
    ) as process:
        try:
            stdout, stderr = process.communicate(timeout=90)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate()
            raise AssertionError(f'AppImage startup timed out: {stdout}\n{stderr}') from None
        if process.returncode:
            raise AssertionError(f'AppImage exited with {process.returncode}: {stdout}\n{stderr}')
    reports = [line for line in stdout.splitlines() if line.startswith('{')]
    if not reports:
        raise AssertionError(f'No startup report: {stdout}\n{stderr}')
    report = json.loads(reports[-1])
    for key in ('appimage', 'relaunchPath', 'updaterPath'):
        assert report[key] == str(expected), (key, report)
    assert report['appdir'], report
    assert Path(report['executable']).is_relative_to(Path(report['appdir'])), report
    assert report['executable'] != str(expected), report
    assert expected.is_file(), expected


def smoke_test(source, version):
    prefix = f'VRCX-0-Nanashi_{version}_'
    assert source.name.startswith(prefix) and source.suffix == '.AppImage', source.name
    expected_name = f'VRCX-0-Nanashi_{source.name[len(prefix):]}'
    digest = checksum(source)
    with tempfile.TemporaryDirectory(prefix='vrcx-appimage-smoke-') as directory:
        root = Path(directory)
        downloads = root / 'My Downloads'
        downloads.mkdir()
        home = root / 'home'
        config = home / '.config'
        autostart = config / 'autostart'
        autostart.mkdir(parents=True)
        image = downloads / source.name
        renamed = downloads / expected_name
        shutil.copy2(source, image)
        image.chmod(0o755)
        arguments = ' --autostart --data-dir "/profile with spaces" %U'
        entries = [autostart / name for name in ('VRCX-0-Nanashi.desktop', 'vrcx-0-nanashi.desktop')]
        for entry in entries:
            entry.write_text(f'[Desktop Entry]\nType=Application\nName=VRCX-0-Nanashi\nExec="{image}"{arguments}\nTryExec={image}\n')
        environment = {key: value for key, value in os.environ.items()
                       if key not in ('APPIMAGE', 'APPDIR', 'ARGV0')}
        environment.update(HOME=str(home), XDG_CONFIG_HOME=str(config),
                           XDG_DATA_HOME=str(home / '.local/share'),
                           XDG_CACHE_HOME=str(home / '.cache'),
                           APPIMAGE_EXTRACT_AND_RUN='1')
        launch(image, renamed, environment)
        assert not image.exists(), image
        assert checksum(renamed) == digest
        for entry in entries:
            text = entry.read_text()
            assert f'Exec="{renamed}"{arguments}\n' in text, text
            assert f'TryExec={renamed}\n' in text, text
        launch(renamed, renamed, environment)
        assert checksum(renamed) == digest
        shutil.copy2(source, image)
        image.chmod(0o755)
        launch(image, image, environment)
        assert checksum(image) == digest and checksum(renamed) == digest
        custom = downloads / 'My Custom App.AppImage'
        renamed.rename(custom)
        launch(custom, custom, environment)
        assert checksum(custom) == digest
    assert checksum(source) == digest
    print('AppImage smoke test passed: first launch, autostart, repeat launch, updater/relaunch paths, collision, custom filename.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('appimage', type=Path)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    smoke_test(args.appimage.resolve(strict=True), args.version)
