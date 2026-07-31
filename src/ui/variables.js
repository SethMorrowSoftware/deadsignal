/* Dead Signal Studio — ui/variables.js
 *
 * The TEXT VARIABLES panel.
 *
 * `{{case}}` expanded to "7749" and `{{badge}}` to "0047" because those are
 * EREBUS's numbers and the studio only ever wired up EREBUS. Once BUNDLE grew
 * campaign profiles that stopped making sense: every other campaign inherited
 * another story's case file with no way to change it.
 *
 * A variable is one fact about the campaign, named once. Set {{subject}} here
 * and every scene, every screen template and every preset that mentions it
 * follows — which is the difference between a preset that is one finished
 * artifact and a preset that is a form you fill in.
 *
 * The panel is rendered into every [data-vars-mount] on the page, so the same
 * list appears beside the VIDEO text box and the SCREEN body without two copies
 * of the state. Values live in the document, so they undo, autosave and travel
 * in the project like everything else.
 */
import { $, escHtml, toast } from '../core/dom.js';
import { getStore } from '../doc/session.js';
import { set } from '../doc/store.js';
import { BUILTIN_VARS, MAX_VARS, RESERVED_VARS, VARS_PATH, isVarName, normalizeVars } from '../core/text.js';

let _onChange = null;

/** The author's variables, from the document. Empty when unbound. */
export function authoredVars() {
  const st = getStore();
  return st ? normalizeVars(st.get(VARS_PATH)) : {};
}

function writeVars(next, label) {
  const st = getStore();
  if (!st) return false;
  st.apply(set(VARS_PATH, normalizeVars(next), { label: label || 'variables' }));
  return true;
}

/** Add or update one variable. */
export function setVar(name, value) {
  if (!isVarName(name)) { toast('A name must start with a letter — letters, digits and _ only', 'err'); return false; }
  if (RESERVED_VARS.includes(name)) { toast(`{{${name}}} is built in and cannot be redefined`, 'err'); return false; }
  const cur = authoredVars();
  if (!(name in cur) && Object.keys(cur).length >= MAX_VARS) {
    toast(`${MAX_VARS} variables is the limit`, 'err');
    return false;
  }
  return writeVars({ ...cur, [name]: value }, `set {{${name}}}`);
}

export function removeVar(name) {
  const cur = authoredVars();
  if (!(name in cur)) return false;
  delete cur[name];
  return writeVars(cur, `remove {{${name}}}`);
}

/** Every mount point gets the same list. */
export function renderVariables() {
  const mounts = document.querySelectorAll('[data-vars-mount]');
  if (!mounts.length) return;
  const vars = authoredVars();
  const names = Object.keys(vars).sort();

  for (const box of mounts) {
    box.replaceChildren();

    const rows = document.createElement('div');
    rows.className = 'vars-rows';
    if (!names.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      // Named after what it is FOR, not after the mechanism.
      p.textContent = 'No variables yet. Add one — say subject = M. WEBB — then write '
        + '{{subject}} in any text box on any tab.';
      rows.appendChild(p);
    }
    for (const name of names) {
      const row = document.createElement('div');
      row.className = 'row vars-row';
      row.innerHTML = '<code class="vars-name">{{' + escHtml(name) + '}}</code>'
        + '<input type="text" class="grow" data-var="' + escHtml(name) + '" value="' + escHtml(vars[name]) + '"'
        + ' aria-label="Value of ' + escHtml(name) + '">'
        + '<button class="btn small" data-rmvar="' + escHtml(name) + '" aria-label="Remove ' + escHtml(name) + '">✕</button>';
      rows.appendChild(row);
    }
    box.appendChild(rows);

    const add = document.createElement('div');
    add.className = 'row vars-add';
    add.innerHTML = '<input type="text" class="vars-newname" placeholder="name" aria-label="New variable name" size="10">'
      + '<input type="text" class="grow vars-newval" placeholder="value" aria-label="New variable value">'
      + '<button class="btn small vars-addbtn">＋ VARIABLE</button>';
    box.appendChild(add);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Built in: '
      + Object.keys(BUILTIN_VARS).map((k) => `{{${k}}}`).join(' ')
      + ' (redefine any of them above) · {{date}} {{seed}} {{random:###}} {{pick:a|b|c}}';
    box.appendChild(hint);
  }
}

/** One delegated handler for every mount. */
function wire(box) {
  const commit = () => { renderVariables(); _onChange?.(); };

  box.addEventListener('change', (e) => {
    const val = e.target.closest('input[data-var]');
    if (val) {
      const cur = authoredVars();
      cur[val.dataset.var] = val.value;
      writeVars(cur, `set {{${val.dataset.var}}}`);
      // No re-render on a value edit: it would replace the field being typed in.
      // But the panel renders into two mounts (VIDEO and SCREEN), and re-rendering
      // neither left the sibling mount showing the OLD value — so mirror the new
      // value into the same variable's input on every other mount directly,
      // leaving the just-edited field untouched.
      for (const other of document.querySelectorAll('[data-vars-mount] input[data-var]')) {
        if (other !== val && other.dataset.var === val.dataset.var) other.value = val.value;
      }
      _onChange?.();
    }
  });

  box.addEventListener('click', (e) => {
    const rm = e.target.closest('button[data-rmvar]');
    if (rm) { removeVar(rm.dataset.rmvar); commit(); return; }
    const addBtn = e.target.closest('.vars-addbtn');
    if (!addBtn) return;
    const wrap = addBtn.closest('.vars-add');
    const name = (wrap.querySelector('.vars-newname')?.value || '').trim();
    const value = wrap.querySelector('.vars-newval')?.value || '';
    if (!name) { toast('Name the variable first', 'err'); return; }
    if (setVar(name, value)) { toast(`{{${name}}} added`); commit(); }
  });

  // Enter in either field adds, so the keyboard path matches the mouse one.
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const wrap = e.target.closest('.vars-add');
    if (!wrap) return;
    e.preventDefault();
    wrap.querySelector('.vars-addbtn')?.click();
  });
}

export function initVariables(onChange) {
  const mounts = document.querySelectorAll('[data-vars-mount]');
  if (!mounts.length) return;
  _onChange = onChange;
  for (const box of mounts) wire(box);
  renderVariables();
}
