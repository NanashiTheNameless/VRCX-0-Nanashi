import vrchatMediaRepository from '@/repositories/vrchatMediaRepository';
import { HOUR_MS, SECOND_MS } from '@/shared/constants/time';
import { useInventoryBundleStore } from '@/state/inventoryBundleStore';

const IGNORED_BUNDLE_TEMPLATE_IDS = new Set([
    'invt_08e50f24-8807-4ec2-a0f9-9e008371280b'
]);
const FIRST_CHECK_DELAY_MS = 60 * SECOND_MS;
const CHECK_INTERVAL_MS = 3 * HOUR_MS;

export async function refreshInventoryBundles(currentUserId: string | null) {
    if (!currentUserId) {
        return;
    }
    const response = await vrchatMediaRepository.getInventoryItems({
        n: 100,
        offset: 0,
        types: 'bundle',
        order: 'newest'
    });
    const bundleIds = (response.json?.data ?? [])
        .filter(
            (item) =>
                Boolean(item.id) &&
                !IGNORED_BUNDLE_TEMPLATE_IDS.has(item.templateId ?? '')
        )
        .map((item) => item.id);
    useInventoryBundleStore.getState().setBundles(currentUserId, bundleIds);
}

export function startInventoryBundleWatch(currentUserId: string) {
    const check = () => {
        refreshInventoryBundles(currentUserId).catch(() => {});
    };
    let interval: ReturnType<typeof setInterval> | null = null;
    const timeout = setTimeout(() => {
        check();
        interval = setInterval(check, CHECK_INTERVAL_MS);
    }, FIRST_CHECK_DELAY_MS);
    return () => {
        clearTimeout(timeout);
        if (interval) {
            clearInterval(interval);
        }
        useInventoryBundleStore.getState().reset();
    };
}
