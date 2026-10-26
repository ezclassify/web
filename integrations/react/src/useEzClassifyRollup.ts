import { useEffect, useState } from 'react';

/**
 * Subscribes to the `ezclassify:rollup` DOM event for the given rollup input
 * and returns the current aggregate marking string as React state.
 *
 * The event is dispatched by EzClassifyUI on the hidden rollup input with
 * `bubbles: true`, so this hook listens at the document level and filters by
 * the target element's id. The initial value is read from the hidden input at
 * mount time; it will already be populated when the hook mounts after
 * `useSchemeEngine` finishes initialization.
 *
 * ```tsx
 * const { ref } = useSchemeEngine(ctx, { rollupId: 'doc-rollup' });
 * // '' until the first rollup, then the rendered aggregate marking.
 * const rollup = useEzClassifyRollup('doc-rollup');
 * ```
 */
export function useEzClassifyRollup(rollupId: string): string {
    const [rollup, setRollup] = useState(() => {
        const field =
            typeof document !== 'undefined'
                ? (document.getElementById(rollupId) as HTMLInputElement | null)
                : null;
        return field?.value ?? '';
    });

    useEffect(() => {
        let alive = true;
        const handler = (e: Event) => {
            const target = e.target as HTMLElement | null;
            if (target?.id !== rollupId) return;
            const detail = (e as CustomEvent<{ rendered?: string }>).detail;
            // A burst of edits can enqueue several rollup notifications before
            // React commits. Read the sink again in a microtask so the hook
            // converges on the actual latest field value rather than retaining
            // an older event payload after the DOM has already advanced.
            queueMicrotask(() => {
                if (!alive) return;
                const field = document.getElementById(
                    rollupId,
                ) as HTMLInputElement | null;
                setRollup(
                    detail?.rendered === undefined
                        ? ''
                        : field?.value || detail.rendered,
                );
            });
        };

        document.addEventListener('ezclassify:rollup', handler);

        // Sync with the hidden input's current value in case EzClassifyUI already
        // ran and populated it before this effect registered.
        const field = document.getElementById(
            rollupId,
        ) as HTMLInputElement | null;
        if (field?.value !== undefined) {
            setRollup(field.value);
        }

        return () => {
            alive = false;
            document.removeEventListener('ezclassify:rollup', handler);
        };
    }, [rollupId]);

    return rollup;
}
