export const defaultLocale = {
    'hint.type': 'Type',
    'hint.browse': 'browse',
    'hint.navigateTags': 'navigate tags',
    'hint.accept': 'accept',
    'hint.save': 'save',
    'hint.removeTag': 'remove tag',
    'hint.close': 'close',
    'hint.acceptOrSave': 'accept or save',
    'hint.setMarking': 'Set marking',
    'hint.addMarking': 'Add marking',
    'hint.toSetMarking': 'to set marking',
    'hint.toAddMarking': 'to add marking',

    'mark.paragraphTitle': 'Paragraph {n}: {label}',
    'mark.invalidLabel': 'Invalid marking: {messages} Activate to edit.',
    'mark.warningLabel': 'Marking has a warning: {messages} Activate to edit.',
    'mark.scanIncomplete':
        'The scan did not read the whole text, so some markings were not checked.',
    'rollup.incomplete':
        'Some markings were not read, so this marking may be incomplete.',

    'placeholder.searchInput': 'Type to search, \u2191\u2193 to browse',
    'placeholder.searchInputTouch': 'Search markings\u2026',

    'aria.markingInput': 'Marking input',
    'aria.searchMarkings': 'Search markings',
    'aria.selectedMarkingsAndSearch': 'Selected markings and search',
    'aria.removeTag': 'Remove {name}',
    'aria.inferredSuffix': ' (inferred)',
    'aria.unprintedSuffix': ' (not shown in the marking)',
    'aria.unreadSuffix': ' (not recognized)',
    'aria.favorites': 'Favorites',
    'aria.favoritesActive': 'Favorites (current marking is saved)',

    'favorites.loading': 'Loading favorites…',
    'favorites.empty': 'No favorites saved yet',
    'favorites.save': 'Save {marking} to favorites',
    'favorites.remove': 'Remove from favorites',
    'favorites.fromScheme': 'From the scheme',

    'dualPane.available': 'Available',
    'dualPane.availableRegion': 'Available concepts',
    'dualPane.filterConcepts': 'Filter concepts...',
    'dualPane.currentMarking': 'Current Marking',
    'dualPane.currentMarkingRegion': 'Current marking',
    'dualPane.selectedList': 'Selected concepts list',
    'dualPane.empty': 'Select concepts from the left',
    'dualPane.auto': 'auto',

    'equivalency.confidence': 'Confidence',

    'a11y.suggestionAdded': '{label} added',
    'a11y.suggestionRemoved': '{label} removed',
    'a11y.composer.count': '{count} suggestions',
    'a11y.composer.countOne': '1 suggestion',
    'a11y.composer.savesAs': 'Saves as {rendered}',
    'a11y.composer.set': 'Marking set to {rendered}',
    'a11y.composer.cleared': 'Marking cleared',
    'aria.clearMarking': 'Clear marking',
    'aria.clearText': 'Clear text',
    'a11y.composer.notSaved': 'Not saved. {problem}',
    'a11y.composer.reverted': 'Changes discarded',
    'a11y.composer.confirmed': '{label} confirmed',
    'a11y.composer.replaced': '{label} replaces {old}',
    'a11y.composer.corrected': '{from} changed to {to}',

    'composer.savesAs': 'Saves as',
    'composer.notSaved': 'Not saved yet',
    'composer.nothing': 'Nothing yet',
    'composer.notRecognized': '\u201c{text}\u201d is not recognized.',
    'composer.nothingMore': 'Nothing more to add here',
    'composer.noReading': 'This does not read as one marking.',
    'composer.readFailed': 'This could not be read just now. Try again.',
    'composer.didYouMean': 'Did you mean {label}?',
    'composer.needs': 'Needs',
    'composer.categories': 'Category',
    'composer.previousCategory': 'Previous category',
    'composer.nextCategory': 'Next category',
    'composer.showAll': 'Show all',
    'composer.more': 'Show {count} more',
    'composer.noMatch': 'No matches for \u201c{query}\u201d',
    'composer.corrections': 'Corrections',
    'composer.brokenRule': '1 rule broken',
    'composer.brokenRules': '{count} rules broken',
    'composer.notYetAvailable': 'Not yet available',
    'composer.addFirst': 'Add {names} first',
    'composer.unavailable': 'Not available with the current marking',
    'composer.matched': 'matched {text}',
    'composer.action.remove': 'removes it',
    'composer.action.replace': 'replaces {label}',
    'composer.inferred': 'inferred',
    'composer.reordered': 'reordered',
    'composer.moreChanges': '+{count} more',
    'composer.readAs': '{from} reads as {to}',
    /** Between two "reads as" notes on the result row. */
    'composer.readAsSeparator': '; ',
    /** Between the concepts an "Add {names} first" row names. */
    'composer.namesSeparator': ' / ',
    /** Between the sentences of one announcement. */
    'a11y.sentenceSeparator': '. ',
    'composer.changeAdded': '+ {label}',
    'composer.changeRemoved': '\u2212 {label}',
    'composer.useCorrection': 'Use {label} for \u201c{text}\u201d',
    'composer.done': 'Done',
    'composer.cancel': 'Cancel',

    'fix.heading': 'Ways to fix',
} as const;

type LocaleKeys = keyof typeof defaultLocale;
type LocaleMap = Record<LocaleKeys, string>;

let _locale: LocaleMap = { ...defaultLocale };

/** Merge custom translations into the active locale, overriding matching keys. */
export function setLocale(locale: Partial<LocaleMap>): void {
    _locale = { ..._locale, ...locale };
}

/** Restore the active locale to the built-in English defaults. */
export function resetLocale(): void {
    _locale = { ...defaultLocale };
}

/**
 * Look up a translated string by key, returning the key itself if no
 * translation exists.
 */
export function t(key: string): string {
    return key in _locale ? _locale[key as LocaleKeys] : key;
}
