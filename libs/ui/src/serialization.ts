import type { Assertion } from '@ezclassify/types';
import { EzClassifyUI } from './ezclassify-ui';
import { getFormat } from './format-resolver';
import { reportPublishFailure } from './store/publish-failure';

/** Serialized shape version. Bump when the field shape changes incompatibly. */
const FORM_STATE_VERSION = 1;

/**
 * Snapshot of all field values, assertions, and scheme metadata at a point in
 * time.
 *
 * ## Structural, not rendered
 *
 * Each field carries its full `assertions` array: the true structured form the
 * store holds, including alternate-scope categories (authority blocks, …) and
 * capture-value free text (`assertion.value`, e.g. a date a scheme asks for). A
 * rendered banner string cannot carry either: it excludes alternate-scope
 * categories and emits only concept labels, never `value`. Serializing the
 * assertions is what lets a snapshot round-trip byte-identically.
 *
 * `conceptIds` and `value` are included for human-readable diffs, but
 * `assertions` is authoritative on restore.
 */
export interface FormState {
    /** Serialized shape version. Every write emits the current version. */
    version: number;
    fields: Array<{
        id: string;
        value: string;
        conceptIds: string[];
        /** The field's full structured assertion set. Authoritative on restore. */
        assertions: Assertion[];
        valid: boolean;
    }>;
    rollup: string;
    schemeId: string;
    schemeVersion: string;
    timestamp: string;
}

/**
 * The store id for a field element. The store keys markings by the host
 * element's `id` (falling back to `name` for the serialized `id`), matching how
 * `EzClassifyUI` registers hosts.
 */
function fieldStoreId(field: { id?: string; name?: string }): string {
    return field.id || field.name || '';
}

/**
 * Read every field's current value and structured assertions into a
 * serializable `FormState` object.
 *
 * The assertion set comes from the store (the field's true committed state),
 * not from re-processing the rendered string; so alternate-scope categories and
 * capture-value free text survive the snapshot. When a store entry is not
 * available for a field (e.g. a bare forms controller in a test harness), it
 * falls back to reading the field value, which recovers `conceptIds` but not
 * scoped or captured state.
 */
export async function captureFormState(
    forms: EzClassifyUI,
): Promise<FormState> {
    const engine = forms.engine;
    const scheme = engine.getSchemeMeta();
    const fields: FormState['fields'] = [];
    const store = forms.store;

    for (const field of forms.fields) {
        const id = fieldStoreId(field);
        const value = field.value.trim();
        const format = getFormat(forms, field);

        // The store holds the field's true structured assertions, including
        // scope-attributed categories and capture values. Prefer it.
        const stored = store && id ? store.get(id) : undefined;
        if (stored && stored.assertions.length > 0) {
            fields.push({
                id,
                value: stored.rendered || value,
                conceptIds: stored.assertions
                    .filter((a) => a.source !== 'inferred')
                    .map((a) => a.conceptId),
                assertions: stored.assertions,
                valid: stored.valid,
            });
            continue;
        }

        // Fallback: no store entry, re-derive conceptIds from the value. This
        // is the lossy path, used only when structured state is genuinely
        // unavailable.
        let conceptIds: string[] = [];
        let valid = true;
        let assertions: Assertion[] = [];
        if (value) {
            const result = await Promise.resolve(
                engine.validate(value, { outputFormat: format }),
            );
            assertions = result.assertions;
            conceptIds = result.assertions
                .filter((a) => a.source !== 'inferred')
                .map((a) => a.conceptId);
            valid = result.valid;
        }

        fields.push({ id, value, conceptIds, assertions, valid });
    }

    const rollup = forms.getRollup();

    return {
        version: FORM_STATE_VERSION,
        fields,
        rollup,
        schemeId: scheme.id,
        schemeVersion: scheme.version,
        timestamp: new Date().toISOString(),
    };
}

/**
 * Write saved field state back into the form and trigger recalculation.
 *
 * When a store is present, each field's structured `assertions` array is
 * published via `publishAssertions`, so scope-attributed categories and capture
 * values are restored intact. Without a store (a bare forms controller), the
 * saved `value` string is written to the input and an `input`/`blur` cycle
 * drives the normal parse path, lossy for scoped state.
 *
 * The publish is fire-and-forget, so a rejection (a transient 5xx or a dropped
 * connection over a REST client) is reported through `reportPublishFailure`
 * rather than left to escape as an unhandled rejection.
 */
export function restoreFormState(forms: EzClassifyUI, state: FormState): void {
    const fieldElements = forms.fields;
    const store = forms.store;

    for (const saved of state.fields) {
        const field = fieldElements.find(
            (f) =>
                (f.id && f.id === saved.id) || (f.name && f.name === saved.id),
        );
        if (!field) continue;

        const storeId = fieldStoreId(field);
        if (store && storeId) {
            // Structured restore: the store re-renders the default-scope banner
            // and carries scoped categories + capture values untouched.
            store
                .publishAssertions(storeId, saved.assertions)
                .catch((error: unknown) =>
                    reportPublishFailure('restoreFormState', storeId, error),
                );
            // Reflect the rendered banner into the input so a native form
            // submit / read sees it; the store writeback also does this, but
            // set it here so it is present synchronously.
            field.value = store.get(storeId).rendered || saved.value;
            continue;
        }

        // No-store path: drive the value through the DOM parse cycle.
        field.value = saved.value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    forms.recalculate();
}

/** Serialize the current form state to a pretty-printed JSON string. */
export async function exportFormState(forms: EzClassifyUI): Promise<string> {
    return JSON.stringify(await captureFormState(forms), null, 2);
}

/**
 * Validate that a parsed snapshot structurally matches `FormState`. This is the
 * untrusted-input boundary: a snapshot can claim the current version and still
 * be missing or mistyping fields, and letting that through surfaces later as an
 * opaque `TypeError` inside the store instead of a clear shape error here.
 */
function assertFormStateShape(
    state: Partial<FormState>,
): asserts state is FormState {
    const malformed = (what: string): Error =>
        new Error(
            `Form state has shape version ${FORM_STATE_VERSION} but ${what}`,
        );

    if (!Array.isArray(state.fields)) {
        throw malformed("'fields' is not an array");
    }
    for (const [index, entry] of state.fields.entries()) {
        const at = `fields[${index}]`;
        if (entry === null || typeof entry !== 'object') {
            throw malformed(`${at} is not an object`);
        }
        if (typeof entry.id !== 'string') {
            throw malformed(`${at}.id is not a string`);
        }
        if (typeof entry.value !== 'string') {
            throw malformed(`${at}.value is not a string`);
        }
        if (!Array.isArray(entry.conceptIds)) {
            throw malformed(`${at}.conceptIds is not an array`);
        }
        if (!Array.isArray(entry.assertions)) {
            throw malformed(`${at}.assertions is not an array`);
        }
        if (typeof entry.valid !== 'boolean') {
            throw malformed(`${at}.valid is not a boolean`);
        }
    }
}

/**
 * Parse a JSON string and restore the form to the saved state. Throws if the
 * snapshot's shape version is not the current one, if the snapshot does not
 * structurally match that shape, or if the saved scheme does not match the
 * current engine scheme.
 */
export function importFormState(forms: EzClassifyUI, json: string): void {
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== 'object') {
        throw new Error(
            `Form state is not a JSON object (got ${parsed === null ? 'null' : typeof parsed})`,
        );
    }
    const state = parsed as Partial<FormState>;
    if (state.version !== FORM_STATE_VERSION) {
        throw new Error(
            `Form state has shape version ${String(state.version)} but this build reads version ${FORM_STATE_VERSION}`,
        );
    }
    assertFormStateShape(state);
    const scheme = forms.engine.getSchemeMeta();
    if (state.schemeId && state.schemeId !== scheme.id) {
        throw new Error(
            `Form state was captured with scheme '${state.schemeId}' but current scheme is '${scheme.id}'`,
        );
    }
    restoreFormState(forms, state);
}
