export const defaultLocale = {
    'hint.setMarking': 'Set marking',
    'hint.addMarking': 'Add marking',

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

    'placeholder.searchInput': 'Search markings',
    'placeholder.searchInputTouch': 'Search\u2026',

    'aria.markingInput': 'Marking input',
    'aria.showSuggestions': 'Show suggestions',
    'aria.searchMarkings': 'Search markings',
    'aria.selectedMarkingsAndSearch': 'Selected markings and search',
    'aria.removeTag': 'Remove {name}',
    'aria.inferredSuffix': ' (inferred)',
    'guide.scanFailed':
        'Unable to analyze text. Your selections are unchanged.',
    'guide.unavailableRules':
        'Guide unavailable. The rules could not be loaded, so this is not a complete list of what applies.',
    'guide.unavailableSetup':
        'Guide unavailable. This checklist is set up incorrectly, so no marking is shown.',
    'guide.analyzePrompt': 'Analyze text to nominate rules for review.',
    'guide.evaluationFailed':
        'The marking for this selection could not be computed. What is shown may be out of date.',
    'guide.nominatedStatus.one':
        '{count} rule nominated. Review the highlighted rows and select the ones that apply.',
    'guide.nominatedStatus.other':
        '{count} rules nominated. Review the highlighted rows and select the ones that apply.',
    'guide.nominatedAnnouncement.one':
        '{count} rule nominated from text. Review and select any that apply.',
    'guide.nominatedAnnouncement.other':
        '{count} rules nominated from text. Review and select any that apply.',
    'guide.noneNominated': 'No rules nominated. Your selections are unchanged.',
    'guide.contributing': 'Contributing to marking:',
    'guide.pasteLabel': 'Paste or type your text',
    'guide.analyzeButton': 'Analyze Text',
    'guide.searchLabel': 'Search rules by keyword',
    'guide.searchPlaceholder': 'Type keywords to filter rules\u2026',
    'guide.searchHint':
        'Type keywords to filter matching rules. Check all that apply.',
    'guide.selectLegend': 'Select all rules that apply',
    'guide.compoundRules': 'Compound Rules',
    'guide.nominatedBadge': 'Nominated',
    'guide.noMatch': 'No rules match \u201c{filter}\u201d',
    'guide.computedLabel': 'Computed marking:',
    'guide.copy': 'Copy',
    'guide.copyLabel': 'Copy marking to clipboard',
    'guide.copied': 'Marking copied to clipboard',
    'guide.copyFailed': 'Failed to copy marking',
    'guide.currentLabel': 'Current marking:',
    'flow.label': 'Decision flow',
    'flow.steps': 'Steps',
    'flow.selectAll': 'Select all that apply.',
    'flow.previous': 'Previous step',
    'flow.next': 'Next step',
    'flow.stepOf': 'Step {n} of {total}, {label}',
    'flow.stepAnnounce': 'Step {n}: {label}',
    'flow.selected': 'Selected {label}',
    'flow.chosenAdvance': 'Selected {choice}. Step {n}: {label}',
    'flow.deselected': 'Deselected {label}',
    'flow.missing': 'Missing:',
    'flow.notSet': 'not set',
    'flow.dotChosen': 'chosen',
    'flow.dotNeedsAnswer': 'needs an answer',
    'flow.dotOptional': 'optional, {notSet}',
    'flow.dotRequired': 'required, {notSet}',
    'flow.stepState': '{label}: {state}',
    'search.matchCount.none': 'No {items} match "{query}"',
    'search.matchCount.one': '{count} {item} match',
    'search.matchCount.other': '{count} {items} match',
    'flow.writeFailed':
        'The marking could not be written just now. Change a choice to try again.',
    'flow.includedBy': 'Included by {choice}',
    'tag.defaultUnwritten': 'Default {category}, not written in the marking',
    'tag.unwritten': 'Not written in the marking',
    'aria.unprintedSuffix': ' (not shown in the marking)',
    'aria.unreadSuffix': ' (not recognized)',
    'aria.overallMarkingPrefix': 'Overall marking: ',
    'aria.favorites': 'Favorites',

    'tools.findings': 'Needs attention',
    'tools.errorCount': '{count} unresolved errors',
    'tools.badgeOne': '1 item needs attention',
    'tools.badgeMany': '{count} items need attention',
    'tools.quickFixes': 'Quick fixes',
    'tools.paragraph': 'Paragraph {n}',

    'favorites.loading': 'Loading favorites…',
    'favorites.empty': 'No favorites saved yet',
    'favorites.fromScheme': 'From the scheme',
    'favorites.saved': 'Saved Favorites',
    'favorites.target': 'Marking target',
    'favorites.chooseTarget': 'Choose a marking',
    'favorites.finishCurrentMarking':
        'Finish the current edit to switch paragraphs.',
    'favorites.editingMarking': 'Editing marking {n} of {total}',
    'favorites.insertParagraph': 'Insert a marking at the current paragraph',
    'favorites.insertAfterParagraph':
        'Insert a marking after the current paragraph',
    'favorites.saveCurrent': 'Save Current Marking',
    'favorites.unsaveCurrent': 'Unsave Current Marking',
    'favorites.applyFailed': 'Could not apply this favorite. Try again.',
    'favorites.saveFailed': 'Could not save this favorite. Try again.',
    'favorites.loadFailed': 'Could not load your favorites. Try again.',
    'favorites.removeFailed': 'Could not remove this favorite. Try again.',
    'favorites.removed': 'Favorite removed',
    'favorites.rememberPrompt': 'Keep Favorites for Your Next Visit?',
    'favorites.remember': 'Remember Favorites on This Browser',
    'favorites.removeEntry': 'Remove Favorite {marking}',
    'favorites.visitOnly': 'This Visit Only',
    'favorites.manage': 'Manage Favorites',
    'favorites.back': 'Back to Favorites',
    'favorites.clear': 'Clear Saved Favorites',
    'favorites.cleared': 'Saved Favorites cleared',
    'favorites.storageFailed': 'Could not change browser storage. Try again.',
    'tools.openHint': 'Auto-fixes and Favorites ({shortcut})',
    'tools.correctionsHint': 'Auto-fixes ({shortcut})',
    'tools.sections': 'Marking Tools Sections',
    'tools.corrections': 'Auto-fixes',
    'tools.entryOne': '1 entry',
    'tools.entryMany': '{count} entries',
    'tools.close': 'Close Marking Tools',
    'tools.emptyAttention': 'No findings for this marking.',
    'tools.unresolvedEntry': 'Has unresolved errors',
    'tools.emptyCorrections': 'No auto-fixes yet',
    'mark.touchActions': 'Marking actions',
    'mark.editMarking': 'Edit marking',
    'mark.removeMarking': 'Remove marking',
    'mark.actionsLabel': '{marking}, marking actions',
    'mark.actionsInvalidLabel':
        '{marking}, marking actions. Invalid marking: {messages}',
    'mark.actionsWarningLabel':
        '{marking}, marking actions. Marking has a warning: {messages}',
    'mark.removeExplicitly': 'Use Remove marking to remove this marking.',

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
    'a11y.selected': 'Selected {label}',
    'a11y.deselected': 'Deselected {label}',
    'a11y.selectedAll.one': 'Selected all {count} item',
    'a11y.selectedAll.other': 'Selected all {count} items',
    'a11y.clearedAll': 'Cleared all selections',
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
    'composer.unverified':
        'This text could not be checked. The result shown may be out of date.',
    'composer.actionFailed': 'That change could not be applied. Try again.',
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
