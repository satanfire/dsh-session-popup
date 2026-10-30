/**
 * Behaviour tests for `@satanfire/dsh-session-popup`.
 *
 * The real `client.js` runs inside the harness: these assertions describe what
 * the shipped file does, not a copy of it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin, makeContext, drive, render } from './harness.mjs';

const NS = 'dsh-session-popup';
const SID = 'sess-alpha';
const OTHER = 'sess-beta';

/**
 * One `sessionStatus` row with the shipped defaults.
 *
 * @param overrides - fields to set.
 * @returns the row.
 */
function row(overrides = {}) {
  return { running: undefined, pendingInteraction: undefined, completionUnread: false, ...overrides };
}

/**
 * A `PendingQuestion`: the shipped shape for an agent asking something.
 *
 * @param text - the first question's text.
 * @returns the interaction.
 */
function question(text) {
  return { questions: [{ question: text }] };
}

/**
 * A `PendingApproval`: the shipped shape for a permission request.
 *
 * @param overrides - fields to set.
 * @returns the interaction.
 */
function approval(overrides = {}) {
  return { toolName: 'bash', reason: 'runs a command', ...overrides };
}

/**
 * A session list snapshot.
 *
 * Each value is either a `mainView` count or a `{ mainView, origin, title }`
 * descriptor.
 *
 * @param spec - per-session descriptors.
 * @returns the snapshot.
 */
function sessions(spec = {}) {
  const byId = {};
  for (const [id, meta] of Object.entries(spec)) {
    const options = typeof meta === 'number' ? { mainView: meta } : meta;
    byId[id] = {
      id,
      displayTitle: options.title ?? `T-${id}`,
      retainedBy: { mainView: options.mainView ?? 0 },
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    };
  }
  return { phase: 'ready', ids: Object.keys(byId), byId };
}

/**
 * Mount the plugin and return everything a test needs.
 *
 * @param options - initial sessions snapshot and status snapshot.
 * @returns context, state, translator, and a render helper.
 */
function mount(options = {}) {
  const loaded = loadPlugin();
  const { ctx, state } = makeContext(options);
  const plugin = loaded.instantiate();
  plugin.apply(ctx);
  const t = ctx.locale.bind(NS);
  return {
    loaded,
    ctx,
    state,
    t,
    html: () => render(state, t),
  };
}

test('definition: id, inject list, and an apply hook', () => {
  const { definition, instantiate } = loadPlugin();
  assert.equal(definition.id, '@satanfire/dsh-session-popup');
  const plugin = instantiate();
  assert.deepEqual(plugin.inject, ['uiSession', 'sessions', 'uiWorkspace', 'slots', 'locale']);
  assert.equal(typeof plugin.apply, 'function');
});

test('apply: registers both dictionaries, one stylesheet, and one overlay', () => {
  const { state, loaded } = mount();

  assert.deepEqual(
    state.dictionaries.map((entry) => entry.lang).sort(),
    ['en', 'zh'],
  );
  assert.equal(loaded.captured.styles.length, 1);
  assert.ok(loaded.captured.styles[0].textContent.includes('.dsh-sp-layer'));

  const overlays = state.slots.filter((slot) => slot.declaration.name === 'shell.overlay');
  assert.equal(overlays.length, 1);
  assert.equal(overlays[0].declaration.id, 'session-popup');
  assert.equal(overlays[0].declaration.locale, NS);
});

test('baseline: a finished task does not replay', () => {
  // The page opens with a session that already ran and stopped: no edge exists.
  const { state, t } = mount({
    status: new Map([[SID, row({ running: false })]]),
  });
  assert.equal(state.status.getSnapshot().size, 1);
  const html = render(state, t);
  assert.equal(html.includes('dsh-sp-card'), false);
  assert.equal(html.includes('dsh-sp-dialog'), false);
  assert.equal(html.includes('dsh-sp-pill'), false);
});

test('baseline: a decision still waiting does show', () => {
  // A pending interaction on first load genuinely still needs an answer.
  const { state, t } = mount({
    sessions: sessions({ [SID]: 0, [OTHER]: 1 }),
    status: new Map([[SID, row({ pendingInteraction: question('Delete 3 files?') })]]),
  });
  const html = render(state, t);
  assert.ok(html.includes('role="alertdialog"'));
  assert.ok(html.includes('需要你处理'));
  assert.ok(html.includes('Delete 3 files?'));
  assert.ok(html.includes('T-sess-alpha'), 'session title is shown');
});

test('edge: running true → false raises one completion card', () => {
  const { state, t } = mount({
    status: new Map([[SID, row({ running: true })]]),
  });
  assert.equal(render(state, t).includes('dsh-sp-card'), false, 'nothing while running');

  drive(state, [new Map([[SID, row({ running: false })]])]);
  const html = render(state, t);
  assert.ok(html.includes('dsh-sp-card'));
  assert.ok(html.includes('任务完成'));
});

test('edge: one decision fires once, not on every snapshot', () => {
  const pending = new Map([[SID, row({ pendingInteraction: question('Approve?') })]]);
  const { state, t } = mount({ status: pending });

  // Re-emitting an equal snapshot must not duplicate the dialog.
  drive(state, [new Map([[SID, row({ pendingInteraction: question('Approve?') })]]), pending]);
  const html = render(state, t);
  const dialogCount = (html.match(/role="alertdialog"/g) ?? []).length;
  assert.equal(dialogCount, 1);
});

test('edge: a replaced interaction fires again', () => {
  const first = question('First question');
  const second = question('Second question');
  const { state, t } = mount({
    status: new Map([[SID, row({ pendingInteraction: first })]]),
  });
  drive(state, [new Map([[SID, row({ pendingInteraction: second })]])]);
  const html = render(state, t);
  assert.ok(html.includes('Second question'));
});

test('muting: a notice about the visited session becomes a pill, not a dialog', () => {
  const { state, t } = mount({
    sessions: sessions({ [SID]: 1 }),
    status: new Map([[SID, row({ pendingInteraction: question('Confirm?') })]]),
  });
  const html = render(state, t);
  assert.equal(html.includes('role="alertdialog"'), false, 'no blocking dialog over the session being read');
  assert.ok(html.includes('dsh-sp-pill'));
  assert.ok(html.includes('待处理'));
});

test('muting: a notice about an unvisited session keeps the dialog', () => {
  const { state, t } = mount({
    sessions: sessions({ [SID]: 0, [OTHER]: 1 }),
    status: new Map([[SID, row({ pendingInteraction: question('Confirm?') })]]),
  });
  const html = render(state, t);
  assert.ok(html.includes('role="alertdialog"'));
  assert.equal(html.includes('dsh-sp-pill'), false);
});

test('stacking: extra decisions are counted, not stacked', () => {
  const { state, t } = mount({
    status: new Map([
      [SID, row({ pendingInteraction: question('First') })],
      [OTHER, row({ pendingInteraction: question('Second') })],
    ]),
  });
  const html = render(state, t);
  assert.equal((html.match(/role="alertdialog"/g) ?? []).length, 1, 'one dialog at a time');
  assert.ok(html.includes('还有 1 个会话在等你'));
});

test('stacking: completion cards are capped', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const running = new Map(ids.map((id) => [id, row({ running: true })]));
  const { state, t } = mount({ status: running });

  drive(state, [new Map(ids.map((id) => [id, row({ running: false })]))]);
  const html = render(state, t);
  const cards = (html.match(/class="dsh-sp-card"/g) ?? []).length;
  assert.equal(cards, 3, 'MAX_COMPLETION_CARDS');
});

test('detail: falls back through reason, questions, then tool name', () => {
  const { state, t } = mount({
    status: new Map([
      [SID, row({ pendingInteraction: question('From questions') })],
    ]),
  });
  assert.ok(render(state, t).includes('From questions'));
});

test('detail: a decision with no text still renders the generic body', () => {
  const { state, t } = mount({
    status: new Map([[SID, row({ pendingInteraction: { toolName: '' } })]]),
  });
  const html = render(state, t);
  assert.ok(html.includes('智能体正在等你确认。'));
});

test('lifecycle: every effect is disposable', () => {
  const { state } = mount();
  const labels = state.effectLabels;
  assert.deepEqual(labels, [
    'dsh-session-popup: dictionaries',
    'dsh-session-popup: styles',
    'dsh-session-popup: status triggers',
  ]);
});

test('lifecycle: a settled decision withdraws its dialog', () => {
  const { state, t } = mount({
    status: new Map([[SID, row({ pendingInteraction: question('Still there?') })]]),
  });
  assert.ok(render(state, t).includes('role="alertdialog"'));

  // The interaction was answered somewhere else; the pending row is gone.
  drive(state, [new Map([[SID, row({ running: false })]])]);
  assert.equal(render(state, t).includes('role="alertdialog"'), false);
});

test('quiet: a completion for the session on screen raises nothing', () => {
  // Every reply ends a run. Alerting on that would mean a notice per message.
  const { state, t } = mount({
    sessions: sessions({ [SID]: 1 }),
    status: new Map([[SID, row({ running: true })]]),
  });
  drive(state, [new Map([[SID, row({ running: false })]])]);

  const html = render(state, t);
  assert.equal(html.includes('dsh-sp-card'), false);
  assert.equal(html.includes('dsh-sp-pill'), false);
});

test('quiet: a subagent child never alerts', () => {
  const { state, t } = mount({
    sessions: sessions({ [SID]: { origin: 'subagent' } }),
    status: new Map([[SID, row({ running: true })]]),
  });
  drive(state, [new Map([[SID, row({ running: false })]])]);

  assert.equal(render(state, t).includes('dsh-sp-card'), false);
});

test('quiet: a subagent decision never alerts either', () => {
  const { state, t } = mount({
    sessions: sessions({ [SID]: { origin: 'subagent' } }),
    status: new Map([[SID, row({ pendingInteraction: question('Internal?') })]]),
  });
  assert.equal(render(state, t).includes('role="alertdialog"'), false);
});

test('alert: a completion for a background session still raises a card', () => {
  const { state, t } = mount({
    sessions: sessions({ [SID]: 0, [OTHER]: 1 }),
    status: new Map([[SID, row({ running: true })]]),
  });
  drive(state, [new Map([[SID, row({ running: false })]])]);

  const html = render(state, t);
  assert.ok(html.includes('dsh-sp-card'));
  assert.ok(html.includes('T-sess-alpha'));
});

test('quiet: a read-only review card is not a decision', () => {
  // Opening a finished question renders a review card into the same slot, with
  // no answer channel. It must not raise a blocking dialog.
  const { state, t } = mount({
    status: new Map([
      [SID, row({ pendingInteraction: { review: {}, questions: [{ question: 'Old question' }] } })],
    ]),
  });
  const html = render(state, t);
  assert.equal(html.includes('role="alertdialog"'), false);
});

test('lifecycle: a null interaction withdraws the dialog', () => {
  // `null` and `undefined` both mean "nothing waiting"; only treating one as
  // absent is how a dialog ends up unable to withdraw.
  const { state, t } = mount({
    status: new Map([[SID, row({ pendingInteraction: question('Still there?') })]]),
  });
  assert.ok(render(state, t).includes('role="alertdialog"'));

  drive(state, [new Map([[SID, row({ pendingInteraction: null })]])]);
  assert.equal(render(state, t).includes('role="alertdialog"'), false);
});
