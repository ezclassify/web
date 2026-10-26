/**
 * Flash a temporary "Copied" badge above the field that fades out after one
 * second.
 */
export function showCopiedIndicator(field: HTMLInputElement): void {
    const wrapper = field.closest('div') as HTMLElement;
    if (!wrapper) return;
    const indicator = document.createElement('div');
    indicator.textContent = 'Copied';
    indicator.className = 'ez-copied-indicator';
    wrapper.appendChild(indicator);
    setTimeout(() => {
        indicator.style.opacity = '0';
    }, 1000);
    setTimeout(() => {
        indicator.remove();
    }, 1400);
}
