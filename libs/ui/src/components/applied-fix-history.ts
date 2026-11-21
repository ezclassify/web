import type { Assertion, Change } from '@ezclassify/types';
import { replacesStated } from './composer/composer-controller';
import { recordAppliedFixes } from './status-mark';

/** The Runtime's applied changes for one marking while the marking still holds. */
export class AppliedFixHistory {
    private held: readonly Assertion[] = [];
    private readonly fixes = new Map<string, Change>();

    record(
        held: readonly Assertion[],
        changes?: readonly Change[],
        reset = false,
    ): void {
        if (reset || replacesStated(this.held, held)) this.clear();
        this.held = [...held];
        this.append(changes);
    }

    append(changes?: readonly Change[]): void {
        recordAppliedFixes(this.fixes, changes);
    }

    clear(): void {
        this.held = [];
        this.fixes.clear();
    }

    values(): Change[] {
        return [...this.fixes.values()];
    }
}
