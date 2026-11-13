/**
 * A typed value the way an output writes it.
 *
 * The engine stores a value in the spelling its concept's encoding names as
 * canonical, and writes it per view in the spelling the encoding declares for
 * that view. A surface that shows a value beside the marking (a summary chip, a
 * reminder of what was typed) shows it the way the marking's output writes it,
 * so the author never sees two spellings of one value. Both directions come
 * from the encoding the scheme declares; the only spellings read here are the
 * ones the contract defines.
 */
import type { CalendarDateSpelling, ValueEncoding } from '@ezclassify/types';

/** The concept view a field writes in when neither it nor its format names one. */
const DEFAULT_VIEW = 'default';

/** A stored calendar date: the canonical spelling, year, month and day. */
const CANONICAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The value as a view writes it.
 *
 * @param value - The value as stored
 * @param encoding - The concept's resolved encoding, if it declares one
 * @param view - The concept view the output writes the value's category in;
 *   undefined for the concept's default view
 * @returns The value in the view's spelling; the stored value for an encoding
 *   that spells every view alike, or a value not in the canonical spelling
 */
export function writtenValue(
    value: string,
    encoding: ValueEncoding | undefined,
    view: string | undefined,
): string {
    if (encoding?.type !== 'calendar-date') return value;
    const spelling: CalendarDateSpelling =
        encoding.views?.[view ?? DEFAULT_VIEW] ?? encoding.canonical;
    const date = CANONICAL_DATE.exec(value);
    if (!date) return value;
    switch (spelling) {
        case 'YYYY-MM-DD':
            return value;
        case 'YYYYMMDD':
            return `${date[1]}${date[2]}${date[3]}`;
    }
}
