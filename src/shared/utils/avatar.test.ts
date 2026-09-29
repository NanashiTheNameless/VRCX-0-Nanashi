import { afterEach, describe, expect, it, vi } from 'vitest';

import { compareUnityVersion } from './avatar';

describe('avatar utils', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('compares legacy unity sort numbers against SDK unity versions', () => {
        expect(compareUnityVersion('20220306000', '2022.3.6f1')).toBe(true);
        expect(compareUnityVersion('20220307000', '2022.3.6f1')).toBe(false);
        expect(compareUnityVersion('50304010', '5.3.4p1')).toBe(true);
    });

    it('returns false for missing or invalid SDK unity versions', () => {
        const errorSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        expect(compareUnityVersion('20220306000', '')).toBe(false);
        expect(compareUnityVersion('20220306000', '2022.3')).toBe(false);
        expect(errorSpy).toHaveBeenCalledTimes(2);
    });
});
