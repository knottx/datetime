import { copyText, selectContents } from './lib/clipboard.ts';
import { icon, renderIcons } from './lib/icons.ts';
import { initTheme } from './lib/theme.ts';
import {
  UNIT_NAME,
  UNIT_SYMBOL,
  digitCount,
  formatInstant,
  nowNs,
  parseEpoch,
  parseIso,
  parseLocal,
  timeZoneId,
  toLocalInputValue,
  typicalUnit,
  type EpochUnit,
  type Formatted,
} from './lib/time.ts';

/* Nothing here touches storage or the network: inputs and results live only in memory. */

type Mode = 'unix' | 'iso' | 'local';
type OutputKey = 'utc' | 'local' | 's' | 'ms' | 'us' | 'ns';

const OUTPUT_KEYS: readonly OutputKey[] = ['utc', 'local', 's', 'ms', 'us', 'ns'];
const MODES: readonly Mode[] = ['unix', 'iso', 'local'];
const COPY_NAMES: Record<OutputKey, string> = {
  utc: 'UTC ISO 8601',
  local: 'local ISO 8601',
  s: 'Unix seconds',
  ms: 'Unix milliseconds',
  us: 'Unix microseconds',
  ns: 'Unix nanoseconds',
};

/* ---------- elements ---------- */

function byId<T extends HTMLElement>(id: string, type: { new (): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Missing #${id}`);
  return element;
}

const resultsPanel = byId('results', HTMLElement);
const resultSource = byId('result-source', HTMLParagraphElement);
const nowButton = byId('now', HTMLButtonElement);
const zoneLabel = byId('zone-local', HTMLSpanElement);
const captions = { utc: byId('caption-utc', HTMLParagraphElement), local: byId('caption-local', HTMLParagraphElement) };
const announcer = byId('announcer', HTMLDivElement);

const outputs = Object.fromEntries(OUTPUT_KEYS.map((key) => [key, byId(`out-${key}`, HTMLParagraphElement)])) as Record<
  OutputKey,
  HTMLParagraphElement
>;
const copyButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-copy]'));
const copyHints = Array.from(document.querySelectorAll<HTMLParagraphElement>('p[data-hint]'));

interface ModeUi {
  form: HTMLFormElement;
  input: HTMLInputElement;
  error: HTMLParagraphElement;
  note: HTMLParagraphElement | null;
}

const ui: Record<Mode, ModeUi> = {
  unix: {
    form: byId('form-unix', HTMLFormElement),
    input: byId('unix-input', HTMLInputElement),
    error: byId('unix-error', HTMLParagraphElement),
    note: byId('unix-note', HTMLParagraphElement),
  },
  iso: {
    form: byId('form-iso', HTMLFormElement),
    input: byId('iso-input', HTMLInputElement),
    error: byId('iso-error', HTMLParagraphElement),
    note: null,
  },
  local: {
    form: byId('form-local', HTMLFormElement),
    input: byId('local-input', HTMLInputElement),
    error: byId('local-error', HTMLParagraphElement),
    note: byId('local-note', HTMLParagraphElement),
  },
};

const modeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="mode"]'));
const unitInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="unit"]'));
const localField = byId('local-field', HTMLDivElement);
const localPicker = byId('local-picker', HTMLButtonElement);
const localZone = byId('local-zone', HTMLParagraphElement);

const zone = timeZoneId();
const singleColumn = window.matchMedia('(max-width: 63.999rem)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac OS/.test(navigator.userAgent);
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const manualCopyHint = isTouch
  ? 'Couldn’t copy automatically. The value is selected, so tap Copy in the menu.'
  : `Couldn’t copy automatically. The value is selected, so press ${isApple ? '⌘C' : 'Ctrl+C'} to copy it.`;

/* ---------- helpers ---------- */

function makeFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long', ...options });
  } catch {
    return null;
  }
}
const utcFormatter = makeFormatter({ timeZone: 'UTC' });
const localFormatter = makeFormatter({});

function announce(message: string): void {
  announcer.textContent = '';
  window.setTimeout(() => (announcer.textContent = message), 50);
}

/** Fills a message paragraph with a leading icon, text, and optional inline action. */
function setMessage(
  element: HTMLParagraphElement,
  iconName: string,
  text: string,
  action?: { label: string; onClick: () => void },
): void {
  const parts: Node[] = [];
  const svg = icon(iconName);
  if (svg) {
    const slot = document.createElement('span');
    slot.dataset.icon = iconName;
    slot.append(svg);
    parts.push(slot);
  }
  const body = document.createElement('span');
  body.className = '[overflow-wrap:anywhere]';
  body.textContent = text;
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-link ml-1';
    button.textContent = action.label;
    button.addEventListener('click', action.onClick);
    body.append(' ', button);
  }
  parts.push(body);
  element.replaceChildren(...parts);
  element.hidden = false;
}

function clearMessage(element: HTMLParagraphElement | null): void {
  if (!element) return;
  element.hidden = true;
  element.replaceChildren();
}

/* ---------- results ---------- */

let current: Formatted;
let currentNs: bigint;
let sourceText = '';
const copiedTimers = new Map<HTMLButtonElement, number>();

function resetCopyFeedback(): void {
  for (const button of copyButtons) {
    window.clearTimeout(copiedTimers.get(button));
    delete button.dataset.copied;
  }
  for (const hint of copyHints) clearMessage(hint);
}

function renderSource(stale: boolean): void {
  resultSource.classList.toggle('text-warning', stale);
  resultSource.classList.toggle('text-fg-subtle', !stale);
  if (stale) {
    setMessage(resultSource, 'circle-alert', `Last valid result · ${sourceText}`);
    resultSource.querySelector('[data-icon]')?.classList.add('size-3', 'shrink-0');
  } else {
    resultSource.textContent = sourceText;
  }
  resultSource.hidden = false;
}

/** Replaces every output with values derived from one instant. */
function showInstant(ns: bigint, source: string): void {
  currentNs = ns;
  current = formatInstant(ns);
  sourceText = source;

  for (const key of OUTPUT_KEYS) outputs[key].textContent = current[key];
  const date = new Date(current.epochMs);
  captions.utc.textContent = utcFormatter?.format(date) ?? '';
  captions.local.textContent = localFormatter?.format(date) ?? '';
  zoneLabel.textContent = zone ? `${zone} · UTC${current.offset}` : `UTC${current.offset}`;

  for (const mode of MODES) clearError(mode);
  resetCopyFeedback();
  renderSource(false);
}

/** On narrow screens the results sit above the form; bring them back into view after converting. */
function revealResults(): void {
  if (!singleColumn.matches || resultsPanel.getBoundingClientRect().top >= 0) return;
  resultsPanel.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

/* ---------- errors ---------- */

function showError(mode: Mode, message: string): void {
  const { input, error } = ui[mode];
  setMessage(error, 'circle-alert', message);
  input.setAttribute('aria-invalid', 'true');
  input.closest<HTMLElement>('.field')?.setAttribute('data-invalid', '');
  clearMessage(ui[mode].note);
  renderSource(true);
  announce(message);
}

function clearError(mode: Mode): void {
  const { input, error } = ui[mode];
  clearMessage(error);
  input.removeAttribute('aria-invalid');
  input.closest<HTMLElement>('.field')?.removeAttribute('data-invalid');
}

function succeed(ns: bigint, source: string): void {
  showInstant(ns, source);
  revealResults();
  announce(`Converted. UTC ${current.utc}. Unix milliseconds ${current.ms}.`);
}

/* ---------- Unix timestamp ---------- */

const selectedUnit = (): EpochUnit =>
  (unitInputs.find((input) => input.checked)?.value as EpochUnit | undefined) ?? 's';

function selectUnit(unit: EpochUnit): void {
  for (const input of unitInputs) input.checked = input.value === unit;
}

function convertUnix(): void {
  const { input, note } = ui.unix;
  const unit = selectedUnit();
  const result = parseEpoch(input.value, unit);
  if (!result.ok) {
    showError('unix', result.error);
    return;
  }
  succeed(result.value, `From Unix ${UNIT_NAME[unit]}`);

  // Units are never guessed, but point out a likely mismatch (e.g. 13 digits read as seconds).
  const digits = digitCount(input.value);
  const typical = typicalUnit(digits);
  if (note && digits >= 9 && typical !== unit && parseEpoch(input.value, typical).ok) {
    setMessage(note, 'info', `${digits} digits usually means ${UNIT_NAME[typical]}.`, {
      label: `Use ${UNIT_SYMBOL[typical]}`,
      onClick: () => {
        selectUnit(typical);
        convertUnix();
        unitInputs.find((i) => i.value === typical)?.focus();
      },
    });
  }
}

/* ---------- ISO 8601 ---------- */

function convertIso(): void {
  const result = parseIso(ui.iso.input.value);
  if (result.ok) succeed(result.value, 'From ISO 8601');
  else showError('iso', result.error);
}

/* ---------- local date & time ---------- */

function convertLocal(): void {
  const { input, note } = ui.local;
  if (input.validity.badInput || input.value === '') {
    showError('local', 'Pick a complete date and time.');
    return;
  }
  const result = parseLocal(input.value);
  if (!result.ok) {
    showError('local', result.error);
    return;
  }
  const { ns, offset, laterOccurrence } = result.value;
  succeed(ns, `From local time (UTC${offset})`);

  if (note && laterOccurrence) {
    setMessage(
      note,
      'info',
      `This time occurs twice${zone ? ` in ${zone}` : ''} because clocks go back. Showing the earlier one (UTC${offset}). The later one is ${laterOccurrence}.`,
      {
        label: 'Use later time',
        onClick: () => {
          ui.iso.input.value = laterOccurrence;
          setMode('iso');
          convertIso();
          ui.iso.input.focus();
        },
      },
    );
  }
}

/* ---------- modes ---------- */

const CONVERTERS: Record<Mode, () => void> = { unix: convertUnix, iso: convertIso, local: convertLocal };

function setMode(mode: Mode): void {
  for (const input of modeInputs) input.checked = input.value === mode;
  for (const key of MODES) ui[key].form.hidden = key !== mode;
  if (mode === 'local' && ui.local.input.value === '') ui.local.input.value = toLocalInputValue(currentNs);
}

for (const input of modeInputs) {
  input.addEventListener('change', () => {
    if (input.checked && MODES.includes(input.value as Mode)) setMode(input.value as Mode);
  });
}

for (const mode of MODES) {
  const { form, input } = ui[mode];
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    CONVERTERS[mode]();
  });
  // Pasting is the usual way in, so convert straight away.
  if (mode !== 'local') {
    input.addEventListener('paste', () => window.setTimeout(() => CONVERTERS[mode](), 0));
  }
  // Editing an invalid value clears its error; the results keep their "last valid" label until the next success.
  input.addEventListener('input', () => {
    if (input.hasAttribute('aria-invalid')) clearError(mode);
    clearMessage(ui[mode].note);
  });
}

for (const input of unitInputs) {
  input.addEventListener('change', () => {
    if (input.checked && ui.unix.input.value.trim() !== '') convertUnix();
  });
}

// A calendar button that opens the native picker, where supported.
if (typeof HTMLInputElement.prototype.showPicker === 'function') {
  localPicker.hidden = false;
  localField.dataset.hasPicker = '';
  localPicker.addEventListener('click', () => {
    try {
      ui.local.input.showPicker();
    } catch {
      ui.local.input.focus();
    }
  });
}
localZone.textContent = zone
  ? `Interpreted in ${zone}, using its UTC offset on the chosen date.`
  : 'Interpreted in your browser’s timezone, using its UTC offset on the chosen date.';

/* ---------- copy ---------- */

async function handleCopy(button: HTMLButtonElement, key: OutputKey): Promise<void> {
  const text = current[key];
  const copied = await copyText(text);
  if (text !== current[key]) return; // The result changed while copying.

  const hint = copyHints.find((element) => element.dataset.hint === key);
  if (copied) {
    if (hint) clearMessage(hint);
    window.clearTimeout(copiedTimers.get(button));
    button.dataset.copied = '';
    copiedTimers.set(
      button,
      window.setTimeout(() => delete button.dataset.copied, 1600),
    );
    announce(`Copied ${COPY_NAMES[key]}.`);
  } else {
    selectContents(outputs[key]);
    if (hint) {
      hint.textContent = manualCopyHint;
      hint.hidden = false;
    }
    announce(manualCopyHint);
  }
}

for (const button of copyButtons) {
  const key = button.dataset.copy as OutputKey;
  if (!OUTPUT_KEYS.includes(key)) continue;
  button.addEventListener('click', () => void handleCopy(button, key));
}

/* ---------- now ---------- */

nowButton.addEventListener('click', () => {
  showInstant(nowNs(), 'Current time');
  for (const mode of MODES) clearMessage(ui[mode].note);
  announce(`Updated to the current time. Unix milliseconds ${current.ms}.`);
});

/* ---------- init ---------- */

renderIcons();
initTheme();
byId('year', HTMLSpanElement).textContent = String(new Date().getFullYear());
showInstant(nowNs(), 'Current time');
setMode('unix');
