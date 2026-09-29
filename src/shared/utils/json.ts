export function safeJsonParse(value: unknown): unknown {
    if (!value) {
        return null;
    }
    try {
        return JSON.parse(String(value));
    } catch {
        return null;
    }
}
