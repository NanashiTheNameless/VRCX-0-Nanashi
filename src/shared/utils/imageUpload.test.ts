import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IMAGE_UPLOAD_ACCEPT } from '@/shared/constants/imageUpload';

const fsMocks = vi.hoisted(() => ({
    readFile: vi.fn(),
    stat: vi.fn()
}));

vi.mock('@tauri-apps/plugin-fs', () => fsMocks);

import { readDroppedImageFile, validateImageUploadFile } from './imageUpload';

describe('imageUpload validation', () => {
    it('accepts supported raster image types below the size limit', () => {
        for (const type of IMAGE_UPLOAD_ACCEPT.split(',')) {
            expect(validateImageUploadFile(new Blob(['x'], { type }))).toEqual({
                ok: true,
                reason: ''
            });
        }
    });

    it('rejects missing, oversized, and unsafe file types', () => {
        expect(validateImageUploadFile(null)).toEqual({
            ok: false,
            reason: 'missing'
        });
        expect(
            validateImageUploadFile(
                new Blob(['12345'], { type: 'image/png' }),
                {
                    maxSize: 5
                }
            )
        ).toEqual({
            ok: false,
            reason: 'too_large'
        });
        expect(
            validateImageUploadFile(
                new Blob(['<svg />'], { type: 'image/svg+xml' })
            )
        ).toEqual({
            ok: false,
            reason: 'not_image'
        });
    });
});

describe('readDroppedImageFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('reads a dropped image into a typed file', async () => {
        fsMocks.stat.mockResolvedValue({ isFile: true, size: 3 });
        fsMocks.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

        const result = await readDroppedImageFile(
            'C:\\Users\\Ava\\Pictures\\Print.JPG'
        );

        expect(fsMocks.readFile).toHaveBeenCalledWith(
            'C:\\Users\\Ava\\Pictures\\Print.JPG'
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.file.name).toBe('Print.JPG');
            expect(result.file.type).toBe('image/jpeg');
            expect(result.file.size).toBe(3);
        }
    });

    it('rejects files that are not supported images without reading them', async () => {
        await expect(
            readDroppedImageFile('/home/ava/notes.txt')
        ).resolves.toEqual({ ok: false, reason: 'not_image' });

        fsMocks.stat.mockResolvedValue({ isFile: false, size: 0 });
        await expect(
            readDroppedImageFile('/home/ava/folder.png')
        ).resolves.toEqual({ ok: false, reason: 'not_image' });

        expect(fsMocks.readFile).not.toHaveBeenCalled();
    });

    it('rejects oversized images before reading them', async () => {
        fsMocks.stat.mockResolvedValue({ isFile: true, size: 5 });

        await expect(
            readDroppedImageFile('/home/ava/huge.png', { maxSize: 5 })
        ).resolves.toEqual({ ok: false, reason: 'too_large' });
        expect(fsMocks.readFile).not.toHaveBeenCalled();
    });
});
