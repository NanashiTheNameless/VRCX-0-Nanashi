import { commands } from '@/platform/tauri/bindings';
import { safeJsonParse } from '@/repositories/baseRepository';

function parseResponseValue(data: string): unknown {
    if (data === '') {
        return '';
    }

    return safeJsonParse(data, data);
}

async function getScreenshotMetadata(path: string) {
    return parseResponseValue(await commands.appGetScreenshotMetadata(path));
}

async function getExtraScreenshotData(path: string, carouselCache = false) {
    return parseResponseValue(
        await commands.appGetExtraScreenshotData(path, carouselCache)
    );
}

const mediaFileRepository = Object.freeze({
    getScreenshotMetadata,
    getExtraScreenshotData
});

export default mediaFileRepository;
