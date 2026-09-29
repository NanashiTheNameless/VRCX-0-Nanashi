import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    fetchImageDataUrl: vi.fn(),
    getFileBase64: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appExternalApiImageDataUrlGet: commandMocks.fetchImageDataUrl,
        appGetFileBase64: commandMocks.getFileBase64
    }
}));

import {
    fetchImageBlob,
    getDownloadImageBase64
} from './fullscreenImageDownload';

describe('fullscreenImageDownload', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('rejects a missing image URL', async () => {
        await expect(fetchImageBlob(undefined)).rejects.toThrow(
            'Missing image URL'
        );
    });

    it('loads HTTP images through the Rust fetch boundary', async () => {
        const blob = new Blob(['image'], { type: 'image/png' });
        commandMocks.fetchImageDataUrl.mockResolvedValue({
            data: 'data:image/png;base64,aW1hZ2U='
        });
        const fetchMock = vi.fn().mockResolvedValue({
            blob: vi.fn().mockResolvedValue(blob)
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchImageBlob('https://example.com/image.png')
        ).resolves.toBe(blob);
        expect(commandMocks.fetchImageDataUrl).toHaveBeenCalledWith({
            url: 'https://example.com/image.png'
        });
        expect(fetchMock).toHaveBeenCalledWith(
            'data:image/png;base64,aW1hZ2U='
        );
    });

    it('rejects non-image payloads from direct and Rust-backed sources', async () => {
        const textBlob = new Blob(['text'], { type: 'text/plain' });
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                blob: vi.fn().mockResolvedValue(textBlob)
            })
        );

        await expect(
            fetchImageBlob('data:text/plain;base64,dGV4dA==')
        ).rejects.toThrow('Unexpected image type: text/plain');

        commandMocks.fetchImageDataUrl.mockResolvedValue({
            data: 'not-a-data-url'
        });
        await expect(
            fetchImageBlob('https://example.com/image.png')
        ).rejects.toThrow('Image response is not a data URL');
    });

    it('prefers a local source path when preparing a download', async () => {
        commandMocks.getFileBase64.mockResolvedValue('local-base64');

        await expect(
            getDownloadImageBase64({
                sourcePath: 'C:\\screenshots\\capture.png',
                url: 'https://example.com/ignored.png'
            })
        ).resolves.toBe('local-base64');
        expect(commandMocks.getFileBase64).toHaveBeenCalledWith(
            'C:\\screenshots\\capture.png'
        );
        expect(commandMocks.fetchImageDataUrl).not.toHaveBeenCalled();
    });

    it('removes the data-URL prefix when preparing a remote download', async () => {
        class FileReaderStub {
            result: string | ArrayBuffer | null = null;
            error: DOMException | null = null;
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;

            readAsDataURL() {
                this.result = 'data:image/png;base64,aW1hZ2U=';
                this.onload?.();
            }
        }

        const blob = new Blob(['image'], { type: 'image/png' });
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                blob: vi.fn().mockResolvedValue(blob)
            })
        );
        vi.stubGlobal('FileReader', FileReaderStub);

        await expect(
            getDownloadImageBase64({
                url: 'data:image/png;base64,aW1hZ2U='
            })
        ).resolves.toBe('aW1hZ2U=');
    });
});
