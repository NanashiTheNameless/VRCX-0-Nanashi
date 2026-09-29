import { commands } from '@/platform/tauri/bindings';

function isHttpUrl(url: string) {
    try {
        const protocol = new URL(url).protocol;
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    if (blob.type && !blob.type.startsWith('image/')) {
        throw new Error(`Unexpected image type: ${blob.type}`);
    }
    return blob;
}

async function fetchImageBlobViaRust(url: string): Promise<Blob> {
    const response = await commands.appExternalApiImageDataUrlGet({ url });
    const dataUrl = typeof response.data === 'string' ? response.data : '';

    if (!dataUrl.startsWith('data:image/')) {
        throw new Error('Image response is not a data URL');
    }

    return dataUrlToBlob(dataUrl);
}

export async function fetchImageBlob(url: string | undefined): Promise<Blob> {
    if (!url) {
        throw new Error('Missing image URL');
    }

    const normalizedUrl = url;
    if (normalizedUrl.startsWith('data:')) {
        return dataUrlToBlob(normalizedUrl);
    }

    if (isHttpUrl(normalizedUrl)) {
        return fetchImageBlobViaRust(normalizedUrl);
    }

    return dataUrlToBlob(normalizedUrl);
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = String(reader.result || '');
            const separatorIndex = dataUrl.indexOf(',');
            resolve(
                separatorIndex >= 0
                    ? dataUrl.slice(separatorIndex + 1)
                    : dataUrl
            );
        };
        reader.onerror = () => {
            reject(reader.error || new Error('Failed to read image data'));
        };
        reader.readAsDataURL(blob);
    });
}

export async function getDownloadImageBase64({
    sourcePath,
    url
}: {
    sourcePath?: string;
    url?: string;
}): Promise<string> {
    if (sourcePath) {
        return commands.appGetFileBase64(sourcePath);
    }

    const blob = await fetchImageBlob(url);
    return blobToBase64(blob);
}
