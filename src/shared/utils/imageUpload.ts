import { readFile, stat } from '@tauri-apps/plugin-fs';

import { MAX_IMAGE_UPLOAD_BYTES } from '@/shared/constants/imageUpload';
export interface ImageUploadValidationOptions {
    maxSize?: number;
}

export type ImageUploadValidationResult =
    | { ok: true; reason: '' }
    | { ok: false; reason: 'missing' | 'too_large' | 'not_image' };

export type DroppedImageFileResult =
    | { ok: true; file: File }
    | { ok: false; reason: 'too_large' | 'not_image' };

const IMAGE_TYPE_BY_EXTENSION: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp'
};

const UPLOAD_TIMEOUT_MS = 30_000;

const SAFE_RASTER_IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/bmp'
]);

export function withUploadTimeout<T>(promise: Promise<T>): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
            () => reject(new Error('Upload timed out')),
            UPLOAD_TIMEOUT_MS
        );
    });
    return Promise.race<T>([promise, timeout]).finally(() => {
        clearTimeout(timeoutId);
    });
}

export async function readFileAsBase64(blob: Blob): Promise<string> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () =>
            reject(reader.error ?? new Error('Failed to read file.'));
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.readAsDataURL(blob);
    });
    const comma = dataUrl.indexOf(',');
    return comma === -1 ? '' : dataUrl.slice(comma + 1);
}

export async function readDroppedImageFile(
    path: string,
    { maxSize = MAX_IMAGE_UPLOAD_BYTES }: ImageUploadValidationOptions = {}
): Promise<DroppedImageFileResult> {
    const name = path.split(/[\\/]/).pop() || '';
    const extension = name.includes('.')
        ? name.slice(name.lastIndexOf('.') + 1).toLowerCase()
        : '';
    const type = IMAGE_TYPE_BY_EXTENSION[extension];
    if (!type) {
        return { ok: false, reason: 'not_image' };
    }
    const info = await stat(path);
    if (!info.isFile) {
        return { ok: false, reason: 'not_image' };
    }
    if (info.size >= maxSize) {
        return { ok: false, reason: 'too_large' };
    }
    const bytes = await readFile(path);
    return { ok: true, file: new File([bytes], name, { type }) };
}

export function validateImageUploadFile(
    file: Blob | File | null | undefined,
    { maxSize = MAX_IMAGE_UPLOAD_BYTES }: ImageUploadValidationOptions = {}
): ImageUploadValidationResult {
    if (!file) {
        return { ok: false, reason: 'missing' };
    }

    if (file.size >= maxSize) {
        return { ok: false, reason: 'too_large' };
    }

    if (!SAFE_RASTER_IMAGE_TYPES.has(String(file.type || '').toLowerCase())) {
        return { ok: false, reason: 'not_image' };
    }

    return { ok: true, reason: '' };
}
