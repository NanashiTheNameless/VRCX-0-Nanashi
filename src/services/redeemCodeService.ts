// Fork: redeeming several VRChat codes at once, one at a time with a pause in
// between so VRChat's API is not hit in a burst.

export const REDEEM_CODE_LIMIT = 20;
export const REDEEM_CODE_DELAY_MS = 3000;

/** Codes separated by commas, semicolons, spaces or new lines; duplicates once. */
export function parseRedeemCodes(input: string): string[] {
    const codes: string[] = [];
    const seen = new Set<string>();
    for (const part of input.split(/[\s,;]+/)) {
        const code = part.trim();
        if (code && !seen.has(code.toUpperCase())) {
            seen.add(code.toUpperCase());
            codes.push(code);
        }
    }
    return codes;
}

export type RedeemCodeOutcome =
    | { code: string; status: 'redeemed' }
    | { code: string; status: 'failed'; error: string }
    | { code: string; status: 'skipped' };

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error ?? '');
}

function isRateLimited(error: unknown): boolean {
    const status =
        error && typeof error === 'object'
            ? (error as { status?: unknown }).status
            : undefined;
    return status === 429 || /\b429\b|too many/i.test(errorText(error));
}

const wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Redeems codes in order. Stops early, leaving the rest skipped, when VRChat
 * says too many requests or `shouldStop` turns true.
 */
export async function redeemCodesInTurn(
    codes: readonly string[],
    redeem: (code: string) => Promise<unknown>,
    {
        delayMs = REDEEM_CODE_DELAY_MS,
        sleep = wait,
        shouldStop = () => false,
        onProgress
    }: {
        delayMs?: number;
        sleep?: (ms: number) => Promise<void>;
        shouldStop?: () => boolean;
        onProgress?: (done: number, total: number) => void;
    } = {}
): Promise<RedeemCodeOutcome[]> {
    const outcomes: RedeemCodeOutcome[] = [];
    let stopped = false;
    for (const [index, code] of codes.entries()) {
        if (stopped || shouldStop()) {
            outcomes.push({ code, status: 'skipped' });
            continue;
        }
        if (index > 0) {
            await sleep(delayMs);
        }
        try {
            await redeem(code);
            outcomes.push({ code, status: 'redeemed' });
        } catch (error) {
            outcomes.push({ code, status: 'failed', error: errorText(error) });
            stopped = isRateLimited(error);
        }
        onProgress?.(index + 1, codes.length);
    }
    return outcomes;
}
