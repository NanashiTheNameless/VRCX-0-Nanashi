import 'i18next';
import type { DefaultNamespace, Namespace } from 'i18next';

declare module 'i18next' {
    // i18next 27 types `t` as a rest-parameter union that rejects an optional
    // second argument, so a `t` could no longer be passed where the app takes
    // `(key, options?) => string`. This overload restores that call shape;
    // runtime behaviour is unchanged.
    interface TFunctionNonStrict<
        Ns extends Namespace = DefaultNamespace,
        KPrefix = undefined
    > {
        (key: string, options?: Record<string, unknown>): string;
    }
}
