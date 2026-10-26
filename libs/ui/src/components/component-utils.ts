/**
 * Barrel re-export of shared DOM utilities for all prototypes. Each module
 * handles a focused concern; this file preserves the original import paths used
 * throughout the codebase.
 */

export {
    showTooltip,
    hideTooltip,
    attachTooltip,
    cleanupTooltipForRoot,
} from './tooltip-manager';
export { createTag, createUnreadTag } from './tag-factory';
export { ensureStatusMark, setStatusMarkFixes } from './status-mark';
export {
    createAnnouncer,
    announce,
    createKeyboardHints,
} from './accessibility-helpers';
export {
    COMPONENT_CSS,
    getComponentStyles,
    reconcileChildren,
    readGeometry,
    isMacPlatform,
} from './dom-helpers';
