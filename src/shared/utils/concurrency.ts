export function createConcurrencyLimiter(limit: number) {
    let active = 0;
    const waiting: Array<() => void> = [];
    return async <T>(task: () => Promise<T>): Promise<T> => {
        if (active >= limit)
            await new Promise<void>((resolve) => waiting.push(resolve));
        active++;
        try {
            return await task();
        } finally {
            active--;
            waiting.shift()?.();
        }
    };
}
