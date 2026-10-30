/**
 * Runtime harness for `@satanfire/dsh-session-popup`.
 *
 * Loads the real `client.js` inside a fake browser shell and a fake Cordis root
 * context, then lets the tests drive `sessionStatus` snapshots and inspect what
 * the plugin registered and rendered. Nothing here re-implements the plugin:
 * the file under test is the file that ships.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The shipped browser half, resolved next to this harness. */
const SRC = fileURLToPath(new URL('../client.js', import.meta.url));

/**
 * Build one observable snapshot source.
 *
 * @param initial - starting value.
 * @returns source with getSnapshot/subscribe/set.
 */
function observable(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      value = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

/**
 * Resolve `{placeholder}` tokens the way the Locale service does.
 *
 * @param raw - dictionary value.
 * @param params - substitution map.
 * @returns the rendered string.
 */
function interpolate(raw, params) {
  if (params === undefined) return String(raw);
  return String(raw).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * Load `client.js` and return the ModuleLoader definition plus capture buffers.
 *
 * @returns the plugin definition, capture buffers, and an instantiator.
 */
export function loadPlugin(env = {}) {
  const captured = { styles: [], listeners: {} };

  const fakeWindow = env.window ?? {
    __ModuleLoader__: {
      load(definition) {
        this.current = definition;
      },
    },
    addEventListener(type, handler) {
      (captured.listeners[type] ??= []).push(handler);
    },
    removeEventListener(type, handler) {
      const list = captured.listeners[type] ?? [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
  };

  if (env.window !== undefined && fakeWindow.__ModuleLoader__ === undefined) {
    fakeWindow.__ModuleLoader__ = {
      load(definition) {
        this.current = definition;
      },
    };
  }

  const fakeDocument = env.document ?? {
    head: {
      appendChild(node) {
        captured.styles.push(node);
      },
    },
    createElement(tag) {
      return { tag, textContent: '', dataset: {}, remove() {} };
    },
  };

  const source = fs.readFileSync(SRC, 'utf8');
  // The bundle assigns into the global `window.__ModuleLoader__`, so the
  // wrapper takes both globals explicitly instead of relying on module scope.
  new Function('window', 'document', source)(fakeWindow, fakeDocument);

  const definition = fakeWindow.__ModuleLoader__.current;
  if (definition === undefined) throw new Error('client.js did not call __ModuleLoader__.load');

  return {
    definition,
    captured,
    /** Instantiate the plugin the way the Client bundle loader does. */
    instantiate() {
      return definition.factory((name) => {
        if (name === 'react') return React;
        throw new Error(`harness: unexpected require(${name})`);
      });
    },
  };
}

/**
 * Build a fake Cordis client root context.
 *
 * @param options - initial world state (sessions snapshot, status snapshot).
 * @returns { ctx, state } where `state` holds the driven sources.
 */
export function makeContext(options = {}) {
  const state = {
    dictionaries: [],
    slots: [],
    effectLabels: [],
    opened: [],
    sessionList: observable(options.sessions ?? { phase: 'ready', ids: [], byId: {} }),
    status: observable(options.status ?? new Map()),
  };

  /** ns → { en: dict, zh: dict } */
  const dictionaries = new Map();

  const ctx = {
    effect(fn, label) {
      state.effectLabels.push(label);
      return fn();
    },
    locale: {
      register(ns, lang, dict) {
        let byLang = dictionaries.get(ns);
        if (byLang === undefined) {
          byLang = {};
          dictionaries.set(ns, byLang);
        }
        byLang[lang] = dict;
        state.dictionaries.push({ ns, lang });
        return () => {};
      },
      bind(ns) {
        const byLang = dictionaries.get(ns) ?? {};
        return (key, params) => {
          // The harness has no locale switch: prefer Chinese, fall back to English.
          const dict = byLang.zh ?? byLang.en ?? {};
          return interpolate(dict[key] ?? key, params);
        };
      },
      getLocale: () => ({ id: 'zh' }),
    },
    slots: {
      inject(_key, callback) {
        return callback();
      },
      register(declaration, component) {
        state.slots.push({ declaration, component });
        return () => {};
      },
    },
    sessions: { list: state.sessionList },
    uiSession: { sessionStatus: state.status },
    uiWorkspace: {
      openSession(sessionId) {
        state.opened.push(sessionId);
      },
    },
  };

  return { ctx, state };
}

/**
 * Push a sequence of status snapshots through the plugin.
 *
 * @param state - harness state.
 * @param snapshots - one Map per step.
 */
export function drive(state, snapshots) {
  for (const snapshot of snapshots) state.status.set(snapshot);
}

/**
 * Render the registered overlay component to static markup.
 *
 * @param state - harness state.
 * @param t - translator function.
 * @returns markup string.
 */
export function render(state, t) {
  const entry = state.slots.find((slot) => slot.declaration.id === 'session-popup');
  if (entry === undefined) throw new Error('session-popup overlay was never registered');
  const element = React.createElement(entry.component, { t });
  return renderToStaticMarkup(element);
}
