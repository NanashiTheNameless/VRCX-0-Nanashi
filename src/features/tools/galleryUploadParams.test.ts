import { describe, expect, it } from 'vitest';

import { buildPrintUploadParams } from './galleryUploadParams';

describe('galleryUploadParams', () => {
    it('limits print upload notes to 32 characters', () => {
        expect(
            buildPrintUploadParams({
                note: '123456789012345678901234567890123',
                timestamp: '2026-06-09T10:11:12'
            }).note
        ).toBe('12345678901234567890123456789012');
    });
});
