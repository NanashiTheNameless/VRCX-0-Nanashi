import { useDeferredValue, useEffect, useState } from 'react';

import configRepository from '@/repositories/configRepository';
import { NOTIFICATION_TYPES } from '@/repositories/notificationPersistenceRepository';
import { safeJsonParse } from '@/shared/utils/json';

import { sanitizeNotificationFilters } from './notificationTableState';

const NOTIFICATION_TABLE_FILTERS_CONFIG_KEY = 'VRCX_notificationTableFilters';

export type NotificationQuickFilter = 'all' | 'action' | 'unread';

export function useNotificationFilters() {
    const [activeTypes, setActiveTypes] = useState<string[]>([]);
    const [quickFilter, setQuickFilter] =
        useState<NotificationQuickFilter>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [filtersReady, setFiltersReady] = useState(false);
    const deferredSearchQuery = useDeferredValue(searchQuery);

    useEffect(() => {
        let active = true;
        configRepository
            .getString(NOTIFICATION_TABLE_FILTERS_CONFIG_KEY, '[]')
            .then((savedFilters) => {
                if (!active) {
                    return;
                }
                setActiveTypes(
                    sanitizeNotificationFilters(
                        safeJsonParse(savedFilters),
                        NOTIFICATION_TYPES
                    )
                );
                setFiltersReady(true);
            })
            .catch(() => {
                if (active) {
                    setFiltersReady(true);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!filtersReady) {
            return;
        }
        configRepository.setString(
            NOTIFICATION_TABLE_FILTERS_CONFIG_KEY,
            JSON.stringify(activeTypes)
        );
    }, [activeTypes, filtersReady]);

    function clearFilters() {
        setActiveTypes([]);
        setQuickFilter('all');
        setSearchQuery('');
    }

    return {
        activeTypes,
        clearFilters,
        deferredSearchQuery,
        filtersReady,
        quickFilter,
        searchQuery,
        setActiveTypes,
        setQuickFilter,
        setSearchQuery
    };
}
