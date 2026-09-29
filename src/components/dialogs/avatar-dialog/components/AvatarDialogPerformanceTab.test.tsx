// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        i18n: { language: 'en' },
        t: (key: string) => key.split('.').at(-1) || key
    })
}));

vi.mock('../../EntityDialogScaffold', () => ({
    EntityDialogTabContent: ({ children }: { children: ReactNode }) => (
        <div>{children}</div>
    )
}));

vi.mock('@/services/entityMediaService', () => ({ openExternalLink: vi.fn() }));
import { openExternalLink } from '@/services/entityMediaService';

import { AvatarDialogPerformanceTab } from './AvatarDialogPerformanceTab';

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('AvatarDialogPerformanceTab', () => {
    it('switches platform values, thresholds and documentation together', () => {
        const { rerender } = render(
            <AvatarDialogPerformanceTab
                platformInfo={{ pc: {}, android: {}, ios: {} }}
                fileAnalysis={{
                    standalonewindows: {
                        _fileSize: '12 MB',
                        avatarStats: { totalPolygons: 18000 }
                    },
                    android: {
                        _fileSize: '3 MB',
                        avatarStats: { totalPolygons: 18000 }
                    }
                }}
            />
        );
        expect(
            screen
                .getByRole('tab', { name: 'PC' })
                .getAttribute('aria-selected')
        ).toBe('true');
        expect(screen.getByText('18,000/70,000')).toBeTruthy();
        expect(screen.queryByText('3 MB')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Android' }));
        expect(
            screen
                .getByRole('tab', { name: 'Android' })
                .getAttribute('aria-selected')
        ).toBe('true');
        expect(screen.getByText('18,000/20,000')).toBeTruthy();
        expect(screen.getByText('3 MB')).toBeTruthy();
        expect(screen.queryByText('12 MB')).toBeNull();
        fireEvent.click(screen.getByText('mobile_rules'));
        expect(openExternalLink).toHaveBeenCalledWith(
            'https://creators.vrchat.com/avatars/avatar-performance-ranking-system/#mobile-limits'
        );
        rerender(
            <AvatarDialogPerformanceTab
                platformInfo={{ pc: {}, android: {}, ios: {} }}
                fileAnalysis={{ standalonewindows: { _fileSize: '12 MB' } }}
            />
        );
        expect(screen.queryAllByRole('tab')).toHaveLength(0);
        expect(screen.queryByText('PC')).toBeNull();
        expect(screen.getByText('12 MB')).toBeTruthy();
        expect(screen.queryByText('Android')).toBeNull();
    });

    it('shows a loading state while detailed analysis is requested', () => {
        render(
            <AvatarDialogPerformanceTab
                platformInfo={{ pc: {}, android: {}, ios: {} }}
                fileAnalysis={{}}
                loading
            />
        );

        expect(screen.getByText('analysis_loading')).toBeTruthy();
    });

    it('explains when detailed analysis is not ready yet', () => {
        const onRefresh = vi.fn();
        render(
            <AvatarDialogPerformanceTab
                platformInfo={{ pc: {}, android: {}, ios: {} }}
                fileAnalysis={{}}
                pending
                onRefresh={onRefresh}
            />
        );

        expect(screen.getByText('analysis_pending')).toBeTruthy();
        fireEvent.click(screen.getByText('refresh'));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('renders completed platforms while another platform is pending', () => {
        render(
            <AvatarDialogPerformanceTab
                platformInfo={{
                    pc: { platform: 'standalonewindows' },
                    android: { platform: 'android' },
                    ios: {}
                }}
                fileAnalysis={{
                    standalonewindows: { _fileSize: '12.50 MB' }
                }}
                pending
            />
        );

        expect(screen.getByText('analysis_pending')).toBeTruthy();
        expect(screen.getByText('12.50 MB')).toBeTruthy();
        expect(screen.getByText('pc_rules')).toBeTruthy();
        expect(screen.queryByText('Android')).toBeNull();
    });

    it('renders the platform rating, sizes, and detailed avatar stats', () => {
        render(
            <AvatarDialogPerformanceTab
                platformInfo={{
                    pc: {
                        platform: 'standalonewindows',
                        performanceRating: 'Good'
                    },
                    android: {},
                    ios: {}
                }}
                fileAnalysis={{
                    standalonewindows: {
                        performanceRating: 'VeryPoor',
                        _fileSize: '12.50 MB',
                        _uncompressedSize: '48.25 MB',
                        _totalTextureUsage: '32.00 MB',
                        avatarStats: {
                            totalPolygons: 123456,
                            totalVertices: 65432,
                            totalTextureUsage: 32 * 1048576,
                            raycastCount: 4,
                            particleTrailsEnabled: true,
                            particleCollisionEnabled: false
                        }
                    }
                }}
            />
        );

        expect(screen.getByText('rating')).toBeTruthy();
        expect(screen.getAllByText('VeryPoor')[0]?.className).toContain(
            'text-red-700'
        );
        expect(screen.getByText('12.50 MB')).toBeTruthy();
        expect(screen.getByText('48.25 MB')).toBeTruthy();
        expect(screen.getByText('32.00/150 MB')).toBeTruthy();
        expect(screen.getByText('123,456/70,000').className).toContain(
            'text-red-700'
        );
        expect(screen.getByText('65,432').className).toContain(
            'text-muted-foreground'
        );
        expect(screen.getByText('4/15')).toBeTruthy();
        expect(screen.getByText('yes').className).toContain('text-amber-700');
        expect(screen.getByText('no').className).toContain('text-green-700');
        fireEvent.click(screen.getByText('pc_rules'));
        expect(openExternalLink).toHaveBeenCalledWith(
            'https://creators.vrchat.com/avatars/avatar-performance-ranking-system/#pc-limits'
        );
    });

    it('keeps the rating visible when detailed analysis is unavailable', () => {
        const onRefresh = vi.fn();
        render(
            <AvatarDialogPerformanceTab
                platformInfo={{
                    pc: {},
                    android: {
                        platform: 'android',
                        performanceRating: 'Medium'
                    },
                    ios: {}
                }}
                fileAnalysis={{}}
                onRefresh={onRefresh}
            />
        );

        expect(screen.getByText('mobile_rules')).toBeTruthy();
        expect(screen.getByText('rating')).toBeTruthy();
        expect(screen.getByText('Medium').className).toContain(
            'text-amber-700'
        );
        expect(screen.getByText('analysis_unavailable')).toBeTruthy();
        fireEvent.click(screen.getByText('refresh'));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it.each(['android', 'ios'] as const)(
        'renders mobile limits and documentation for %s',
        (platform) => {
            render(
                <AvatarDialogPerformanceTab
                    platformInfo={{ pc: {}, android: {}, ios: {} }}
                    fileAnalysis={{
                        [platform]: {
                            avatarStats: { totalPolygons: 18000, lightCount: 0 }
                        }
                    }}
                />
            );
            expect(screen.getByText('18,000/20,000').className).toContain(
                'text-orange-700'
            );
            expect(screen.queryByText('lights')).toBeNull();
            fireEvent.click(screen.getByText('mobile_rules'));
            expect(openExternalLink).toHaveBeenCalledWith(
                'https://creators.vrchat.com/avatars/avatar-performance-ranking-system/#mobile-limits'
            );
        }
    );
});
