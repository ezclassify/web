import { describe, expect, it } from 'vitest';
import { injectEzClassifyFacet } from '@ezclassify/angular';

describe('Angular public API', () => {
    it('exports the component-library facet adapter', () => {
        expect(typeof injectEzClassifyFacet).toBe('function');
    });
});
