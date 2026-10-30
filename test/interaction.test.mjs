/**
 * Interaction tests for `@satanfire/dsh-session-popup`.
 *
 * These mount the real overlay into jsdom through `react-dom/client`, so click
 * handlers, Escape, and the self-dismiss countdown are exercised for real.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import { loadPlugin, makeContext } from './harness.mjs';

const NS = 'dsh-session-popup';
const SID = 'sess-alpha';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;

const { createRoot } = await import('react-dom/client');
const { act } = React;

/**
 * One `sessionStatus` row.
 *
 * @param overrides - fields to set.
 * @returns the row.
 */
function row(overrides = {}) {
  return { running: undefined, pendingInteraction: undefined, completionUnread: false, ...overrides };
}

/**
 * Mount the plugin and render its overlay into a fresh jsdom container.
 *
 * @param options - initial status snapshot.
 * @returns handles for driving and inspecting the mounted tree.
 */
function mount(options = {}) {
  const loaded = loadPlugin({ window: dom.window, document: dom.window.document });
  const { ctx, state } = makeContext(options);
  const plugin = loaded.instantiate();
  plugin.apply(ctx);

  const t = ctx.locale.bind(NS);
  const entry = state.slots.find((slot) => slot.declaration.id === 'session-popup');
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);

  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(entry.component, { t }));
  });

  return {
    state,
    ctx,
    container,
    /** Push a new status snapshot and flush React. */
    push(snapshot) {
      act(() => {
        state.status.set(snapshot);
      });
    },
    /** Dispatch a click and flush React. */
    click(node) {
      act(() => {
        node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test('dialog: "open session" opens the session and closes the dialog', () => {
  const view = mount({
    status: new Map([[SID, row({ pendingInteraction: { questions: [{ question: 'Run it?' }] } })]]),
  });

  assert.ok(view.container.querySelector('[role="alertdialog"]'));
  const primary = view.container.querySelector('.dsh-sp-dialog .dsh-sp-btn[data-variant="primary"]');
  assert.ok(primary, 'primary action exists');

  view.click(primary);

  assert.deepEqual(view.state.opened, [SID]);
  assert.equal(view.container.querySelector('[role="alertdialog"]'), null);
  view.unmount();
});

test('dialog: the scrim dismisses without opening anything', () => {
  const view = mount({
    status: new Map([[SID, row({ pendingInteraction: { questions: [{ question: 'Run it?' }] } })]]),
  });

  const scrim = view.container.querySelector('.dsh-sp-scrim');
  assert.ok(scrim);
  view.click(scrim);

  assert.deepEqual(view.state.opened, []);
  assert.equal(view.container.querySelector('[role="alertdialog"]'), null);
  view.unmount();
});

test('dialog: Escape dismisses', () => {
  const view = mount({
    status: new Map([[SID, row({ pendingInteraction: { questions: [{ question: 'Run it?' }] } })]]),
  });

  act(() => {
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

  assert.equal(view.container.querySelector('[role="alertdialog"]'), null);
  view.unmount();
});

test('dialog: focus lands inside the dialog on mount', () => {
  const view = mount({
    status: new Map([[SID, row({ pendingInteraction: { questions: [{ question: 'Run it?' }] } })]]),
  });
  const dialog = view.container.querySelector('[role="alertdialog"]');
  assert.equal(dom.window.document.activeElement, dialog);
  view.unmount();
});

test('card: clicking the body opens the session', () => {
  const view = mount({ status: new Map([[SID, row({ running: true })]]) });
  view.push(new Map([[SID, row({ running: false })]]));

  const body = view.container.querySelector('.dsh-sp-card-row');
  assert.ok(body, 'completion card rendered');
  view.click(body);

  assert.deepEqual(view.state.opened, [SID]);
  assert.equal(view.container.querySelector('.dsh-sp-card'), null);
  view.unmount();
});

test('card: dismiss button removes it without opening', () => {
  const view = mount({ status: new Map([[SID, row({ running: true })]]) });
  view.push(new Map([[SID, row({ running: false })]]));

  const close = view.container.querySelector('.dsh-sp-card-close');
  assert.ok(close);
  view.click(close);

  assert.deepEqual(view.state.opened, []);
  assert.equal(view.container.querySelector('.dsh-sp-card'), null);
  view.unmount();
});

test('card: it dismisses itself once the countdown elapses', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = mount({ status: new Map([[SID, row({ running: true })]]) });
  view.push(new Map([[SID, row({ running: false })]]));
  assert.ok(view.container.querySelector('.dsh-sp-card'), 'card is up');

  act(() => {
    t.mock.timers.tick(9000);
  });

  assert.equal(view.container.querySelector('.dsh-sp-card'), null);
  view.unmount();
});

test('card: a card pushed out of the stack is retired, not replayed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ids = ['a', 'b', 'c', 'd'];
  const view = mount({ status: new Map(ids.map((id) => [id, row({ running: true })])) });

  view.push(new Map(ids.map((id) => [id, row({ running: false })])));
  assert.equal(view.container.querySelectorAll('.dsh-sp-card').length, 3, 'only three are shown');

  // Let every visible card expire. The fourth must NOT come back: its notice was
  // retired when it lost its slot, so nothing is left holding a timer.
  act(() => {
    t.mock.timers.tick(9000);
  });
  assert.equal(view.container.querySelectorAll('.dsh-sp-card').length, 0);
  view.unmount();
});
