/**
 * Return the controller-owned CSS: screen-reader utility, error state, the
 * concept tooltip, and the copied indicator.
 */
export function getControllerStyles(): string {
    return `
    /* EzClassifyUI layout classes */
    .ez-sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0,0,0,0);
      white-space: nowrap;
      border: 0;
    }
    [data-ezclassify-error] {
      border-color: var(--ez-color-error, #b91c1c);
    }
    .ez-parent-validation-notice {
      color: var(--ez-color-error, #b91c1c);
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
      margin-top: 0.125rem;
    }

    /* Concept tooltip */
    .ez-concept-tooltip {
      position: fixed;
      background: var(--ez-tooltip-bg, #1a1a2e);
      color: var(--ez-tooltip-color, #fff);
      font-size: 0.75rem;
      max-width: 18.75rem;
      padding: 0.5rem 0.75rem;
      border-radius: 4px;
      z-index: 30000;
      pointer-events: none;
      line-height: 1.5;
    }

    /* Copied indicator */
    .ez-copied-indicator {
      position: absolute;
      top: -1.5rem;
      right: 0;
      background: var(--ez-color-success, #22c55e);
      color: #fff;
      font-size: 0.6875rem;
      padding: 2px 0.5rem;
      border-radius: 4px;
      z-index: 10001;
      pointer-events: none;
      opacity: 1;
      transition: opacity 0.3s;
    }
  `;
}
