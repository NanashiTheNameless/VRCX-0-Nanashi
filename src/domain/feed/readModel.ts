export type FeedCursor = {
    createdAt: number;
    sourceRank: number;
    rowId: number;
};

export type FeedReadModelResult<TRow = Record<string, unknown>> = {
    rows: TRow[];
    maxSequence: number;
    persistedCursor?: FeedCursor | null;
    persistedHasMore?: boolean;
};
