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
    'mark.added': 'Added {value} to {category}.',
    'mark.removed': 'Removed {value} from {category}.',
    'mark.replaced': 'Replaced {old} with {new} in {category}.',
    'mark.rule': 'Rule: {rule}',
    'mark.changesOne': '1 change made by a marking rule',
    'mark.changesMany': '{count} changes made by marking rules',
    'mark.notReviewed': ', not yet reviewed',
    'mark.undoLastEdit': 'Undo last edit',
    'mark.undoLastEditDescription':
        'Puts the marking back to what it was before your last edit.',
    'rollup.incomplete':
        'Some markings were not read, so this marking may be incomplete.',
    'banner.noMarking': 'No marking',
    'banner.pageMarking': 'Page marking',
    'banner.levelMarking': '{name} marking',
    'banner.bucketNotRead': 'Not read',

    'placeholder.searchInput': 'Type to search, \u2191\u2193 to browse',
    'placeholder.searchInputTouch': 'Search\u2026',

    'aria.markingInput': 'Marking input',
    'aria.showSuggestions': 'Show suggestions',
    'aria.searchMarkings': 'Search markings',
    'aria.selectedMarkingsAndSearch': 'Selected markings and search',
    'aria.removeTag': 'Remove {name}',
    'aria.inferredSuffix': ' (inferred)',
    'flow.includedBy': 'Included by {choice}',
    'tag.defaultUnwritten': 'Default {category}, not written in the marking',
    'tag.unwritten': 'Not written in the marking',
    'aria.unprintedSuffix': ' (not shown in the marking)',
    'aria.unreadSuffix': ' (not recognized)',
    'aria.overallMarkingPrefix': 'Overall marking: ',
    'aria.favorites': 'Favorites',
    'aria.favoritesActive': 'Favorites (current marking is saved)',

    'favorites.loading': 'Loading favorites…',
    'favorites.empty': 'No favorites saved yet',
    'favorites.save': 'Save {marking} to favorites',
    'favorites.remove': 'Remove from favorites',
    'favorites.fromScheme': 'From the scheme',
    'favorites.saved': 'Saved Favorites',
    'favorites.editingMarking': 'Editing marking {n} of {total}',
    'favorites.insertParagraph': 'Insert a marking at the current paragraph',
    'favorites.saveCurrent': 'Save Current Marking',
    'favorites.unsaveCurrent': 'Unsave Current Marking',
    'favorites.applyFailed': 'Could not apply this favorite. Try again.',
    'favorites.removeFailed': 'Could not remove this favorite. Try again.',
    'favorites.removed': 'Favorite removed',
    'favorites.rememberPrompt': 'Keep Favorites for Your Next Visit?',
    'favorites.remember': 'Remember Favorites on This Browser',
    'favorites.visitOnly': 'This Visit Only',
    'favorites.manage': 'Manage Favorites',
    'favorites.back': 'Back to Favorites',
    'favorites.clear': 'Clear Saved Favorites',
    'favorites.cleared': 'Saved Favorites cleared',
    'favorites.storageFailed': 'Could not change browser storage. Try again.',
    'tools.sections': 'Marking Tools Sections',
    'tools.corrections': 'Corrections',
    'tools.close': 'Close Marking Tools',
    'tools.emptyCorrections': 'No automatic corrections',

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
    'a11y.composer.cleared': 'Marking cleared. Undo is available.',
    'a11y.markingRestored': 'Marking restored.',
    'a11y.lastEditUndone': 'Last edit undone.',
    'aria.clearMarking': 'Clear marking',
    'aria.clearWholeMarking': 'Clear the whole marking',
    'aria.undoClear': 'Undo clear',
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

    'translate.notCarried': 'Not carried',
    'translate.notSelected': 'Not selected',
    'translate.forbidden': 'The crosswalk forbids translating this marking.',
    'translate.invalidSource':
        'The marking does not read, so it was not translated.',
    'translate.targetInvalid': 'The translated marking does not stand.',
    'translate.failed': 'The marking could not be translated.',
    'translate.disposition.review': 'needs review',
    'translate.disposition.omit': 'omitted',
    'translate.disposition.forbid': 'forbidden',
    'translate.disposition.unmapped': 'no mapping',
    'translate.disposition.not-selected': 'not selected',
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
