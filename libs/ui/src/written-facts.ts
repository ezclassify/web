/**
 * Which of a marking's facts the marking writes, read from the engine's render
 * assessments.
 *
 * A marking holds more facts than it writes. The members a group stands for
 * collapse into the group's one written name, and a category's default can be
 * one no output prints. Those facts are real: access and rollup read them. But
 * the author signs what the marking writes, so a field neither draws such a
 * fact as a value of the marking nor says a rule changed the marking when the
 * rule only derived one.
 *
 * The engine says what each render did with each fact (`emitted`, `omitted`,
 * `collapsed`), and that is the only evidence read here. A field can show its
 * marking in more than one form, so a fact counts as written when any form the
 * field shows writes it. A form writes the categories of its own surface only;
 * leaving out a fact of another surface says nothing about whether the marking
 * writes it, so that is not taken as evidence either.
 */

import type { AssertionRef, RenderAssessment } from '@ezclassify/types';
import { scopesOfCategory, type ScopeSource } from './scopes';

/** One form a field shows its marking in, and what writing that form did. */
export interface ShownForm {
    /** The output the form was written in, when the field knows it. */
    formatId?: string;
    /**
     * The scope whose surface the form writes, when the field knows that but
     * not the output: a store's text, for one, states the default scope. Read
     * from `formatId` otherwise. A form whose surface is no scope the scheme
     * declares is taken to write every surface the marking has.
     */
    surface?: string;
    /** The engine's assessment of that render, when it reported one. */
    assessment?: Partial<
        Pick<RenderAssessment, 'emitted' | 'omitted' | 'collapsed'>
    >;
}

/** The scheme metadata the surface of a form and its categories are read from. */
export interface WrittenFactSource extends ScopeSource {
    /** The scheme's outputs, each with the scope whose surface it writes. */
    formats?: ReadonlyArray<{ id: string; surface?: string }>;
}

type FactRef = Pick<AssertionRef, 'categoryId' | 'conceptId'>;

const keyOf = (ref: FactRef) => `${ref.categoryId}\u0000${ref.conceptId}`;

/**
 * A test of whether the marking a field shows writes a fact. A fact is
 * unwritten only when a form whose surface owns its category left it out or
 * collapsed it into another value, and no form the field shows wrote it. Every
 * other fact counts as written, including one no assessment mentions.
 *
 * @param forms - The forms the field shows its marking in
 * @param categories - The scheme's categories, with the scopes they declare
 * @param meta - The scheme's scope and output metadata
 * @returns A test of a fact by its category and concept
 */
export function writtenFactTest(
    forms: readonly ShownForm[],
    categories: ReadonlyArray<{ id: string; scopes?: readonly string[] }>,
    meta: WrittenFactSource,
): (ref: FactRef) => boolean {
    const emitted = new Set<string>();
    for (const form of forms)
        for (const ref of form.assessment?.emitted ?? [])
            emitted.add(keyOf(ref));
    const byId = new Map(categories.map((c) => [c.id, c]));
    const declared = new Set((meta.scopes ?? []).map((scope) => scope.id));
    const unwritten = new Set<string>();
    for (const form of forms) {
        const assessment = form.assessment;
        if (!assessment) continue;
        const surface =
            form.surface ??
            (form.formatId
                ? meta.formats?.find((f) => f.id === form.formatId)?.surface
                : undefined);
        // A form of one scope's surface speaks only for the categories that
        // scope owns.
        const owns = (categoryId: string) => {
            if (surface === undefined || !declared.has(surface)) return true;
            const category = byId.get(categoryId);
            return (
                category !== undefined &&
                scopesOfCategory(category, meta).includes(surface)
            );
        };
        for (const ref of [
            ...(assessment.omitted ?? []),
            ...(assessment.collapsed ?? []).flat(),
        ]) {
            const key = keyOf(ref);
            if (!emitted.has(key) && owns(ref.categoryId)) unwritten.add(key);
        }
    }
    return (ref) => !unwritten.has(keyOf(ref));
}
