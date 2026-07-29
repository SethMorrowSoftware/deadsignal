/* Dead Signal Studio — ui/packs.js
 *
 * Panel copy for the aesthetic pack control. The pack itself is data
 * (core/packs.js) and the action lives with the aesthetic it extends
 * (core/palettes.js `applyPack`) — this is only the explanation, kept here so
 * ui/params.js gathers every hint from the same place.
 */
export function packParamHints() {
  return {
    'pack-apply': ['Apply pack', 0,
      'The aesthetic switch reskins the tool and sets a palette. This goes the rest of the '
      + 'way: it also loads that world’s starting preset on VIDEO, AUDIO and SCREEN, as a '
      + 'single undo entry. Locked sections are respected, exactly as when you choose a '
      + 'preset by hand. Each aesthetic also names the scenes and screens that belong to it, '
      + 'which is what groups those two pickers — grouped, never filtered, so nothing is '
      + 'ever hidden from you.'],
  };
}
