// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { setDisplayTimeZone } from '@/shared/utils/displayTimeZone';

import { NotificationFeed } from './NotificationFeed';

vi.mock('@/components/data-table/DataTableView', () => ({
    DataTableSurface: ({ children }: { children: React.ReactNode }) => children,
    DataTablePagination: () => null
}));
vi.mock('./NotificationRow', () => ({ NotificationRow: () => null }));
afterEach(() => {
    cleanup();
    setDisplayTimeZone('');
    vi.useRealTimers();
});

it.each([
    ['2026-11-02T05:30:00Z', '2026-11-02T05:15:00Z', '2026-11-01T04:15:00Z'],
    ['2026-03-09T04:30:00Z', '2026-03-09T04:15:00Z', '2026-03-08T05:15:00Z']
])(
    'groups notifications by display timezone and finds yesterday across DST at %s',
    (now, today, yesterday) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(now));
        setDisplayTimeZone('America/New_York');
        const rows = [
            { id: 'today', createdAt: Date.parse(today) / 1000 },
            {
                id: 'yesterday',
                createdAt: Date.parse(yesterday) / 1000
            }
        ];
        const props = {
            rows,
            table: { getPageCount: () => 1 } as ComponentProps<
                typeof NotificationFeed
            >['table'],
            detail: '',
            loadStatus: 'idle',
            sourceRowsCount: 2,
            hasActiveFilters: false,
            rowsCount: 2,
            pagination: { pageIndex: 0, pageSize: 20 },
            pageSizes: [20],
            onPageSizeChange: vi.fn(),
            onClearFilters: vi.fn(),
            canInviteFromCurrentLocation: false,
            handlers: {
                onAcceptFriendRequest: vi.fn(),
                onAcceptRequestInvite: vi.fn(),
                onHideNotification: vi.fn(),
                onIgnoreNotificationLocally: vi.fn(),
                onMarkSeen: vi.fn(),
                onSendInviteResponseWithMessage: vi.fn(),
                onSendNotificationResponse: vi.fn(),
                onDeleteNotification: vi.fn(),
                onOpenImagePreview: vi.fn(),
                onOpenLink: vi.fn()
            }
        } as ComponentProps<typeof NotificationFeed>;
        render(<NotificationFeed {...props} />);
        expect(screen.getByText('view.notification.feed.today')).toBeTruthy();
        expect(
            screen.getByText('view.notification.feed.yesterday')
        ).toBeTruthy();
    }
);
