import { isRecord } from '@/shared/utils/record';

export type UserReportOption = {
    value: string;
    label: string;
    tooltip: string;
};

export type UserReportCategory = UserReportOption & {
    reasons: UserReportOption[];
};

function reportOption(
    value: string,
    definitions: Record<string, unknown>
): UserReportOption {
    const definition = definitions[value];
    const text = isRecord(definition) ? definition.text : undefined;
    const tooltip = isRecord(definition) ? definition.tooltip : undefined;
    return {
        value,
        label: typeof text === 'string' && text.trim() ? text : value,
        tooltip: typeof tooltip === 'string' ? tooltip : ''
    };
}

function reportOrder(value: string, definitions: Record<string, unknown>) {
    const definition = definitions[value];
    const order = isRecord(definition) ? Number(definition.order) : NaN;
    return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
}

export function userReportCategories(
    config: Record<string, unknown> | null
): UserReportCategory[] {
    const reportOptions = isRecord(config?.reportOptions)
        ? config.reportOptions
        : {};
    const userOptions = isRecord(reportOptions.user) ? reportOptions.user : {};
    const categories = isRecord(config?.reportCategories)
        ? config.reportCategories
        : {};
    const reasons = isRecord(config?.reportReasons) ? config.reportReasons : {};

    return Object.entries(userOptions)
        .map(([category, reasonKeys]) => ({
            ...reportOption(category, categories),
            reasons: (Array.isArray(reasonKeys) ? reasonKeys : [])
                .filter(
                    (reason): reason is string =>
                        typeof reason === 'string' && Boolean(reason.trim())
                )
                .map((reason) => reportOption(reason, reasons))
        }))
        .filter((category) => category.reasons.length > 0)
        .sort(
            (a, b) =>
                reportOrder(a.value, categories) -
                reportOrder(b.value, categories)
        );
}
