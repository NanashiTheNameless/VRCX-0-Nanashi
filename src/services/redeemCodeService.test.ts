import { describe, expect, it, vi } from 'vitest';

import { parseRedeemCodes, redeemCodesInTurn } from './redeemCodeService';

describe('redeeming several codes', () => {
    it('splits on commas and spaces and drops repeats', () => {
        expect(
            parseRedeemCodes(' ABC123, def456 ,abc123;GHI789\nJKL000 ')
        ).toEqual(['ABC123', 'def456', 'GHI789', 'JKL000']);
        expect(parseRedeemCodes(' , ;')).toEqual([]);
    });

    it('waits between codes and reports each one', async () => {
        const sleep = vi.fn().mockResolvedValue(undefined);
        const redeem = vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockRejectedValueOnce(new Error('Invalid code'))
            .mockResolvedValueOnce(null);
        const progress = vi.fn();

        const outcomes = await redeemCodesInTurn(['A1', 'B2', 'C3'], redeem, {
            delayMs: 3000,
            sleep,
            onProgress: progress
        });

        expect(outcomes).toEqual([
            { code: 'A1', status: 'redeemed' },
            { code: 'B2', status: 'failed', error: 'Invalid code' },
            { code: 'C3', status: 'redeemed' }
        ]);
        expect(sleep).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(3000);
        expect(progress).toHaveBeenLastCalledWith(3, 3);
    });

    it('stops after VRChat says too many requests', async () => {
        const redeem = vi
            .fn()
            .mockRejectedValueOnce(
                Object.assign(new Error('Too Many Requests'), { status: 429 })
            );
        const outcomes = await redeemCodesInTurn(['A1', 'B2'], redeem, {
            sleep: () => Promise.resolve()
        });
        expect(outcomes.map((outcome) => outcome.status)).toEqual([
            'failed',
            'skipped'
        ]);
        expect(redeem).toHaveBeenCalledTimes(1);
    });
});
