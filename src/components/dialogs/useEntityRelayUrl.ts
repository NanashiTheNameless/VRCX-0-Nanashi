import { useEffect, useState } from 'react';

import { entityRelayUrl } from '@/services/remoteSyncWebsiteService';

export function useEntityRelayUrl(kind: 'world' | 'avatar', id: string) {
    const [url, setUrl] = useState('');

    useEffect(() => {
        let active = true;
        setUrl('');
        if (!id) {
            return;
        }
        entityRelayUrl(kind, id)
            .then((value) => {
                if (active) {
                    setUrl(value);
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [kind, id]);

    return url;
}
