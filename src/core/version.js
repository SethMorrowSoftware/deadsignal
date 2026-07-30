/* Dead Signal Studio — core/version.js
 *
 * What build is this?
 *
 * The tool has no package.json, no build step and nothing that stamps a
 * revision, so until now the answer was "the one you happen to have". That is
 * survivable while the only user is the author and fatal the moment there are
 * beta testers: a report that says "the timeline drops the last clip" is only
 * actionable if you know which timeline they had.
 *
 * Hand-maintained on purpose. A generated stamp needs a build step, and not
 * having one is a design commitment this repository makes everywhere else.
 * Bump VERSION when you cut a release; the deep suite checks it is well-formed
 * and that the interface and the diagnostics agree about it.
 */

/** Semantic version of the studio itself. Bump on release. */
export const VERSION = '0.9.0-beta.1';

/** Shown wherever the build needs naming in one string. */
export const BUILD = `Dead Signal Studio ${VERSION}`;
