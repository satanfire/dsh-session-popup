/**
 * Browser half of `@satanfire/dsh-session-popup`.
 *
 * Three surfaces, all mounted in the frame-wide `shell.overlay` layer (the
 * shipped seat for "a badge, a toast stack or a status pill"):
 *
 *   1. A centred dialog when the agent is BLOCKED on you — an approval or a
 *      question. It does not time out: it waits for you. Close it with the
 *      button, the scrim, Escape, or "Open session".
 *   2. A corner card when a task FINISHES. It expires on its own, and the
 *      countdown pauses while the pointer rests on it.
 *   3. A small pill for notices about the session you are ALREADY looking at.
 *      A blocking dialog over the conversation you are reading is noise — the
 *      pill keeps the fact without covering the page.
 *
 * Triggers are edges, not levels, so one alert fires once:
 *
 *   - `pendingInteraction` appearing (including on first load: a decision that
 *     is still open when you open the page genuinely still needs you).
 *   - `running` going true → false (NEVER on first load: the baseline carries
 *     no edge, so opening the page does not replay history).
 *
 * The plugin is deliberately not configurable. Defaults live in the constants
 * below; there is no settings page and no Host Config schema.
 *
 * @module @satanfire/dsh-session-popup/client
 */

window.__ModuleLoader__.load({
  id: '@satanfire/dsh-session-popup',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace this half owns. */
    const NS = 'dsh-session-popup';

    //#region tunables
    //
    // Constants, not config: the plugin ships one opinionated behaviour so it
    // needs no settings page and no Host schema. Change these lines to change
    // that behaviour; nothing else reads them.

    /** How long a finished-task card stays before it dismisses itself. */
    const COMPLETION_TTL_MS = 9000;
    /** How many finished-task cards may stack at once; the oldest drops first. */
    const MAX_COMPLETION_CARDS = 3;
    /** How many notices are held in memory (guards against a runaway stream). */
    const NOTICE_LIMIT = 40;
    /** Longest detail line rendered inside a dialog or card, in characters. */
    const DETAIL_MAX = 220;
    /** Longest session title rendered, in characters. */
    const TITLE_MAX = 60;

    //#endregion

    //#region copy

    /**
     * Dictionaries. Keys are flat so the Host `t()` lookup stays a plain map
     * read. `{name}` placeholders are filled by the Locale service.
     */
    const COPY = {
      en: {
        'decision.title': 'Needs your input',
        'decision.body': 'The agent is waiting for your decision.',
        'decision.open': 'Open session',
        'decision.later': 'Later',
        'decision.more': '{count} more sessions are waiting',
        'decision.one': '1 more session is waiting',
        'completion.title': 'Task finished',
        'completion.body': 'This session has gone idle.',
        'completion.open': 'View',
        'muted.decision': 'Pending',
        'muted.completion': 'Done',
        'muted.one': '{count} update',
        'muted.many': '{count} updates',
        'close': 'Close',
        'kind.decision': 'Waiting for you',
        'kind.completion': 'Finished',
      },
      zh: {
        'decision.title': '需要你处理',
        'decision.body': '智能体正在等你确认。',
        'decision.open': '打开会话',
        'decision.later': '稍后处理',
        'decision.more': '还有 {count} 个会话在等你',
        'decision.one': '还有 1 个会话在等你',
        'completion.title': '任务完成',
        'completion.body': '这个会话已经空闲。',
        'completion.open': '查看',
        'muted.decision': '待处理',
        'muted.completion': '已完成',
        'muted.one': '{count} 条更新',
        'muted.many': '{count} 条更新',
        'close': '关闭',
        'kind.decision': '等你处理',
        'kind.completion': '已完成',
      },
    };

    //#endregion

    //#region styles

    /**
     * Scoped stylesheet. Every colour is a theme alias token, so light and dark
     * both follow the active theme without a second rule set.
     */
    const CSS = `
      .dsh-sp-layer { position:fixed; inset:0; z-index:2147483000; pointer-events:none;
        font-family:inherit; font-size:13px; line-height:19px;
        -webkit-font-smoothing:antialiased; }
      .dsh-sp-layer * { box-sizing:border-box; }

      /* ---- centred decision dialog ---- */

      .dsh-sp-scrim { position:fixed; inset:0; pointer-events:auto; background:rgba(12,14,18,.42);
        animation:dsh-sp-fade .14s ease-out both; }
      .dsh-sp-scrim[data-quiet] { background:rgba(12,14,18,.26); }

      .dsh-sp-dialog-wrap { position:fixed; inset:0; display:flex; align-items:center;
        justify-content:center; padding:24px; pointer-events:none; }
      .dsh-sp-dialog { pointer-events:auto; position:relative; width:min(480px,100%);
        max-height:calc(100vh - 48px); overflow:auto; border-radius:12px;
        border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-overlay);
        box-shadow:0 20px 48px rgba(0,0,0,.34), 0 2px 8px rgba(0,0,0,.18);
        padding:20px 20px 16px; animation:dsh-sp-pop .16s cubic-bezier(.2,.8,.3,1) both;
        color:var(--dsw-alias-label-primary); }
      .dsh-sp-dialog:focus { outline:none; }
      .dsh-sp-dialog:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:3px; }

      .dsh-sp-head { display:flex; align-items:flex-start; gap:12px; padding-right:28px; }
      .dsh-sp-mark { flex:none; width:32px; height:32px; border-radius:9px; display:flex;
        align-items:center; justify-content:center; }
      .dsh-sp-mark[data-kind="decision"] { background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent);
        color:var(--dsw-alias-state-warn-primary); }
      .dsh-sp-mark[data-kind="completion"] { background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent);
        color:var(--dsw-alias-state-success-primary); }
      .dsh-sp-mark svg { width:17px; height:17px; display:block; }

      .dsh-sp-headtext { min-width:0; flex:1; padding-top:1px; }
      .dsh-sp-title { margin:0; font-size:15px; line-height:22px; font-weight:600;
        overflow-wrap:anywhere; }
      .dsh-sp-session { margin:2px 0 0; color:var(--dsw-alias-label-secondary);
        font-size:12px; line-height:17px; overflow-wrap:anywhere;
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }

      .dsh-sp-detail { margin:12px 0 0; color:var(--dsw-alias-label-primary);
        line-height:20px; overflow-wrap:anywhere; white-space:pre-wrap;
        display:-webkit-box; -webkit-line-clamp:6; -webkit-box-orient:vertical; overflow:hidden; }

      .dsh-sp-actions { display:flex; align-items:center; gap:8px; margin-top:16px; flex-wrap:wrap; }
      .dsh-sp-actions .dsh-sp-spacer { flex:1; }
      .dsh-sp-btn { font:inherit; font-size:13px; line-height:18px; border-radius:7px;
        min-height:32px; padding:7px 14px; cursor:pointer; border:1px solid transparent;
        transition:background .12s ease, border-color .12s ease; }
      .dsh-sp-btn:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
      .dsh-sp-btn[data-variant="primary"] { background:var(--dsw-alias-brand-primary);
        color:var(--dsw-alias-bg-base); font-weight:600; }
      .dsh-sp-btn[data-variant="primary"]:hover { filter:brightness(1.06); }
      .dsh-sp-btn[data-variant="quiet"] { background:transparent;
        border-color:var(--dsw-alias-border-l2); color:var(--dsw-alias-label-secondary); }
      .dsh-sp-btn[data-variant="quiet"]:hover { background:var(--dsw-alias-bg-layer-2);
        color:var(--dsw-alias-label-primary); }

      .dsh-sp-more { margin:10px 0 0; color:var(--dsw-alias-label-secondary); font-size:12px;
        line-height:17px; }

      .dsh-sp-close { position:absolute; top:10px; right:10px; width:26px; height:26px;
        display:flex; align-items:center; justify-content:center; border:none; padding:0;
        border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary);
        cursor:pointer; }
      .dsh-sp-close:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
      .dsh-sp-close:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
      .dsh-sp-close svg { width:13px; height:13px; display:block; }

      /* ---- corner stack ---- */

      .dsh-sp-corner { position:fixed; top:14px; right:14px; display:flex;
        flex-direction:column; align-items:flex-end; gap:8px;
        max-width:min(360px, calc(100vw - 28px)); pointer-events:none; }

      .dsh-sp-card { pointer-events:auto; position:relative; width:min(340px, calc(100vw - 28px));
        border-radius:10px; border:1px solid var(--dsw-alias-border-l2);
        background:var(--dsw-alias-bg-overlay); padding:11px 34px 11px 12px;
        box-shadow:0 10px 26px rgba(0,0,0,.24), 0 1px 3px rgba(0,0,0,.14);
        animation:dsh-sp-slide .18s cubic-bezier(.2,.8,.3,1) both;
        color:var(--dsw-alias-label-primary); }
      .dsh-sp-card:hover { border-color:var(--dsw-alias-border-l2); }
      .dsh-sp-card[data-clickable] { cursor:pointer; }
      .dsh-sp-card-row { display:flex; align-items:flex-start; gap:9px; min-width:0;
        border-radius:5px; }
      .dsh-sp-card-row:focus-visible { outline:2px solid var(--dsw-alias-brand-primary);
        outline-offset:2px; }
      .dsh-sp-card-mark { flex:none; width:20px; height:20px; border-radius:6px; display:flex;
        align-items:center; justify-content:center; margin-top:1px; }
      .dsh-sp-card-mark[data-kind="completion"] { background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent);
        color:var(--dsw-alias-state-success-primary); }
      .dsh-sp-card-mark[data-kind="decision"] { background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent);
        color:var(--dsw-alias-state-warn-primary); }
      .dsh-sp-card-mark svg { width:12px; height:12px; display:block; }
      .dsh-sp-card-text { min-width:0; flex:1; }
      .dsh-sp-card-title { font-size:13px; line-height:18px; font-weight:600; overflow-wrap:anywhere; }
      .dsh-sp-card-session { color:var(--dsw-alias-label-secondary); font-size:12px;
        line-height:17px; margin-top:1px; overflow-wrap:anywhere;
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .dsh-sp-card-close { position:absolute; top:7px; right:7px; width:22px; height:22px;
        display:flex; align-items:center; justify-content:center; border:none; padding:0;
        border-radius:5px; background:transparent; color:var(--dsw-alias-label-secondary);
        cursor:pointer; }
      .dsh-sp-card-close:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
      .dsh-sp-card-close:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
      .dsh-sp-card-close svg { width:11px; height:11px; display:block; }
      .dsh-sp-card-progress { position:absolute; left:0; bottom:0; height:2px;
        border-radius:0 0 0 10px; background:var(--dsw-alias-state-success-primary); opacity:.5; }

      /* ---- muted pill ---- */

      .dsh-sp-pill { pointer-events:auto; display:inline-flex; align-items:center; gap:6px;
        border-radius:999px; border:1px solid var(--dsw-alias-border-l2);
        background:var(--dsw-alias-bg-overlay); color:var(--dsw-alias-label-secondary);
        font:inherit; font-size:12px; line-height:16px; padding:4px 10px 4px 8px;
        cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.16);
        animation:dsh-sp-slide .18s cubic-bezier(.2,.8,.3,1) both; }
      .dsh-sp-pill:hover { color:var(--dsw-alias-label-primary);
        border-color:var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-2); }
      .dsh-sp-pill:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
      .dsh-sp-dot { width:7px; height:7px; border-radius:50%; flex:none; }
      .dsh-sp-dot[data-kind="decision"] { background:var(--dsw-alias-state-warn-primary); }
      .dsh-sp-dot[data-kind="completion"] { background:var(--dsw-alias-state-success-primary); }

      /* ---- motion ---- */

      @keyframes dsh-sp-fade { from { opacity:0; } to { opacity:1; } }
      @keyframes dsh-sp-pop { from { opacity:0; transform:translateY(10px) scale(.975); }
        to { opacity:1; transform:none; } }
      @keyframes dsh-sp-slide { from { opacity:0; transform:translateX(20px); }
        to { opacity:1; transform:none; } }
      @keyframes dsh-sp-drain { from { width:100%; } to { width:0%; } }

      @media (prefers-reduced-motion: reduce) {
        .dsh-sp-scrim, .dsh-sp-dialog, .dsh-sp-card, .dsh-sp-pill { animation:none; }
      }
      @media (max-width:520px) {
        .dsh-sp-corner { top:10px; right:10px; }
        .dsh-sp-dialog { padding:18px 16px 14px; }
      }
    `;

    //#endregion

    //#region store

    /**
     * A tiny external store for notices.
     *
     * Deliberately not React state: the producer is a Cordis effect (a
     * `sessionStatus` subscription), which lives outside the render tree. The
     * component subscribes through `useSyncExternalStore`, so the effect stays
     * the only writer and React only re-reads.
     *
     * `getSnapshot` returns the SAME array until the contents actually change:
     * `useSyncExternalStore` compares by reference and would loop otherwise.
     *
     * @returns the store facade.
     */
    function createStore() {
      /** @type {object[]} current notices, oldest first. */
      let items = [];
      /** @type {Set<() => void>} reactive readers. */
      const listeners = new Set();

      const emit = () => {
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch {
            // A throwing reader must not stop the others.
          }
        }
      };

      const replace = (next) => {
        if (next.length === items.length && next.every((item, index) => item === items[index])) return;
        items = next;
        emit();
      };

      return {
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot() {
          return items;
        },
        add(notice) {
          const kept = items.length >= NOTICE_LIMIT ? items.slice(items.length - NOTICE_LIMIT + 1) : items;
          replace([...kept, notice]);
        },
        remove(id) {
          replace(items.filter((item) => item.id !== id));
        },
        /** Drop every notice matching a predicate (decision lifecycle). */
        removeWhere(predicate) {
          replace(items.filter((item) => !predicate(item)));
        },
        /** Drop every notice belonging to one session (used by the pill). */
        removeSession(sessionId) {
          replace(items.filter((item) => item.sessionId !== sessionId));
        },
      };
    }

    //#endregion

    //#region helpers

    /**
     * Pull plain text out of a value that may be a string or a rich fragment.
     *
     * The Host sends interaction reasons as either shape depending on the
     * producer, so both are accepted and anything else yields an empty string
     * rather than "[object Object]".
     *
     * @param value - candidate text.
     * @returns the text, or an empty string.
     */
    function plainText(value) {
      if (typeof value === 'string') return value;
      if (value === null || typeof value !== 'object') return '';
      for (const key of ['text', 'value', 'content']) {
        if (typeof value[key] === 'string') return value[key];
      }
      return '';
    }

    /**
     * One-line summary of a pending interaction, for a dialog or a card.
     *
     * The two interaction kinds are mutually exclusive, so the question text
     * wins outright when present: a `PendingQuestion` carries only `questions`,
     * while a `PendingApproval` carries `displayReason` / `reason` / `toolName`
     * and no questions. Within an approval, the display reason beats the raw
     * reason, which beats the bare tool name.
     *
     * @param interaction - a pendingInteraction object.
     * @returns the summary, trimmed to {@link DETAIL_MAX}; possibly empty.
     */
    function interactionDetail(interaction) {
      const firstQuestion = Array.isArray(interaction?.questions)
        ? plainText(interaction.questions[0]?.question)
        : '';
      const summary =
        firstQuestion ||
        plainText(interaction?.displayReason) ||
        plainText(interaction?.reason) ||
        (typeof interaction?.toolName === 'string' ? interaction.toolName : '');
      const flat = summary.replace(/\s+/g, ' ').trim();
      return flat.length > DETAIL_MAX ? `${flat.slice(0, DETAIL_MAX - 1)}…` : flat;
    }

    /**
     * Trim one line of text to a display budget.
     *
     * @param text - source text.
     * @param max - longest allowed length.
     * @returns the trimmed text.
     */
    function clamp(text, max) {
      return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    }

    /**
     * Work out which session the main column is showing.
     *
     * Retention is the shipped signal: a session the main view holds has
     * `retainedBy.mainView > 0`. Read on demand rather than subscribed, because
     * it is only consulted at the moment an edge fires.
     *
     * @param ctx - client root context.
     * @param sessionId - session to test.
     * @returns whether that session is the one on screen.
     */
    function isCurrentSession(ctx, sessionId) {
      const row = ctx.sessions?.list?.getSnapshot()?.byId?.[sessionId];
      return (row?.retainedBy?.mainView ?? 0) > 0;
    }

    /**
     * Read a session's display title.
     *
     * @param ctx - client root context.
     * @param sessionId - session to name.
     * @returns the title, or a short id when the session has none.
     */
    function sessionTitle(ctx, sessionId) {
      const row = ctx.sessions?.list?.getSnapshot()?.byId?.[sessionId];
      const title = row?.displayTitle || row?.title || '';
      return clamp(title.trim() === '' ? String(sessionId).slice(0, 8) : title, TITLE_MAX);
    }

    /**
     * Whether a session is one the user browses as its own thing.
     *
     * Subagent children carry `origin: 'subagent'` and the shipped sidebar hides
     * them outright — they are an implementation detail of the session that
     * spawned them. Alerting on one would surface a "task finished" card for a
     * session the user cannot even select, so they are skipped entirely.
     *
     * An unknown session stays alertable: losing a real decision is worse than
     * one extra card.
     *
     * @param ctx - client root context.
     * @param sessionId - session to test.
     * @returns whether the session may raise an alert.
     */
    function isAlertableSession(ctx, sessionId) {
      const row = ctx.sessions?.list?.getSnapshot()?.byId?.[sessionId];
      if (row === undefined || row === null) return true;
      return row.origin !== 'subagent';
    }

    /**
     * Diff two `sessionStatus` snapshots into alert edges.
     *
     * Two rules, each firing once:
     *
     *   - a `pendingInteraction` that was absent (or different) is an edge,
     *     INCLUDING on the baseline read — a decision still open when the page
     *     loads is genuinely still waiting;
     *   - `running: true → not true` is an edge, but ONLY once a baseline
     *     exists, so opening the page never replays finished history.
     *
     * @param previous - earlier snapshot, or undefined for the baseline read.
     * @param next - latest snapshot.
     * @returns one entry per edge.
     */
    function diffStatus(previous, next) {
      const edges = [];
      if (!(next instanceof Map)) return edges;
      for (const [sessionId, status] of next) {
        const before = previous?.get(sessionId);
        const interaction = status?.pendingInteraction;
        if (interaction !== undefined && interaction !== null && interaction !== before?.pendingInteraction) {
          edges.push({ kind: 'decision', sessionId, interaction });
        }
        if (previous !== undefined && before?.running === true && status?.running !== true) {
          edges.push({ kind: 'completion', sessionId });
        }
      }
      return edges;
    }

    //#endregion

    //#region icons

    /** Warning triangle, for a blocked decision. */
    const ICON_DECISION = ['M12 3.2 21.2 19a1.4 1.4 0 0 1-1.2 2.1H4a1.4 1.4 0 0 1-1.2-2.1Z', 'M12 9v4.4', 'M12 16.9h.01'];
    /** Check inside a circle, for a finished task. */
    const ICON_COMPLETION = ['M20.5 11.2a8.5 8.5 0 1 1-3.1-5.6', 'M8.6 11.5l3 3 7.6-7.6'];
    /** Cross, for dismiss buttons. */
    const ICON_CLOSE = ['M4.5 4.5l7.5 7.5', 'M12 4.5 4.5 12'];

    /**
     * Render one stroked icon.
     *
     * @param paths - SVG path data strings.
     * @returns the SVG element.
     */
    function icon(paths) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        paths.map((d, index) => h('path', { key: index, d })),
      );
    }

    //#endregion

    //#region components

    /**
     * The centred dialog shown while the agent is blocked on the user.
     *
     * Focus moves into the dialog when it appears and Escape dismisses it, so
     * the interruption is reachable and escapable from the keyboard. The scrim
     * is clickable as a third dismissal path.
     *
     * @param props - component props.
     * @returns the scrim and dialog, or null.
     */
    function DecisionDialog({ notice, moreCount, t, onOpen, onDismiss }) {
      const dialogRef = React.useRef(null);

      React.useEffect(() => {
        dialogRef.current?.focus();
      }, [notice.id]);

      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onDismiss(notice.id);
          }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
      }, [notice.id, onDismiss]);

      const detail = notice.detail === '' ? t('decision.body') : notice.detail;
      const more =
        moreCount > 1 ? t(moreCount === 2 ? 'decision.one' : 'decision.more', { count: moreCount - 1 }) : '';

      return h(
        React.Fragment,
        null,
        h('div', { key: 'scrim', className: 'dsh-sp-scrim', onClick: () => onDismiss(notice.id) }),
        h(
          'div',
          { key: 'wrap', className: 'dsh-sp-dialog-wrap' },
          h(
            'div',
            {
              ref: dialogRef,
              className: 'dsh-sp-dialog',
              role: 'alertdialog',
              'aria-modal': 'true',
              'aria-labelledby': `dsh-sp-title-${notice.id}`,
              tabIndex: -1,
            },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-sp-close',
                onClick: () => onDismiss(notice.id),
                title: t('close'),
                'aria-label': t('close'),
              },
              icon(ICON_CLOSE),
            ),
            h(
              'div',
              { className: 'dsh-sp-head' },
              h('div', { className: 'dsh-sp-mark', 'data-kind': 'decision' }, icon(ICON_DECISION)),
              h(
                'div',
                { className: 'dsh-sp-headtext' },
                h('p', { className: 'dsh-sp-title', id: `dsh-sp-title-${notice.id}` }, t('decision.title')),
                h('p', { className: 'dsh-sp-session' }, notice.title),
              ),
            ),
            h('p', { className: 'dsh-sp-detail' }, detail),
            h(
              'div',
              { className: 'dsh-sp-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-sp-btn',
                  'data-variant': 'primary',
                  onClick: () => onOpen(notice.sessionId, notice.id),
                },
                t('decision.open'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-sp-btn',
                  'data-variant': 'quiet',
                  onClick: () => onDismiss(notice.id),
                },
                t('decision.later'),
              ),
            ),
            more === '' ? null : h('p', { className: 'dsh-sp-more' }, more),
          ),
        ),
      );
    }

    /**
     * One corner card for a finished task.
     *
     * The countdown lives here rather than in the store so a hover can hold it:
     * the timer is torn down while the pointer rests on the card and restarted
     * on leave.
     *
     * @param props - component props.
     * @returns the card.
     */
    function CompletionCard({ notice, t, onOpen, onDismiss }) {
      const [held, setHeld] = React.useState(false);

      React.useEffect(() => {
        if (held) return undefined;
        const timer = setTimeout(() => onDismiss(notice.id), COMPLETION_TTL_MS);
        return () => clearTimeout(timer);
      }, [held, notice.id, onDismiss]);

      return h(
        'div',
        {
          className: 'dsh-sp-card',
          'data-clickable': '',
          onMouseEnter: () => setHeld(true),
          onMouseLeave: () => setHeld(false),
        },
        // The whole card is the target: a finished task has exactly one useful
        // action, so a separate "view" button would only add a second way to do
        // the same thing.
        h(
          'div',
          {
            className: 'dsh-sp-card-row',
            role: 'button',
            tabIndex: 0,
            onClick: () => onOpen(notice.sessionId, notice.id),
            onKeyDown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onOpen(notice.sessionId, notice.id);
            },
          },
          h('div', { className: 'dsh-sp-card-mark', 'data-kind': 'completion' }, icon(ICON_COMPLETION)),
          h(
            'div',
            { className: 'dsh-sp-card-text' },
            h('div', { className: 'dsh-sp-card-title' }, t('completion.title')),
            h('div', { className: 'dsh-sp-card-session' }, notice.title),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-sp-card-close',
            onClick: (event) => {
              event.stopPropagation();
              onDismiss(notice.id);
            },
            title: t('close'),
            'aria-label': t('close'),
          },
          icon(ICON_CLOSE),
        ),
        held
          ? null
          : h('div', {
              className: 'dsh-sp-card-progress',
              style: { animation: `dsh-sp-drain ${COMPLETION_TTL_MS}ms linear both` },
            }),
      );
    }

    /**
     * The pill standing in for notices about the session already on screen.
     *
     * One pill per session would clutter the corner, and a modal over the
     * conversation being read defeats the purpose. The newest notice decides
     * the tint and the label; the count says how many are held.
     *
     * @param props - component props.
     * @returns the pill.
     */
    function MutedPill({ notices, t, onOpen }) {
      const newest = notices[notices.length - 1];
      const decisions = notices.filter((notice) => notice.kind === 'decision').length;
      const kind = decisions > 0 ? 'decision' : 'completion';
      const label = kind === 'decision' ? t('muted.decision') : t('muted.completion');
      const count =
        notices.length === 1
          ? label
          : `${label} · ${t(notices.length === 1 ? 'muted.one' : 'muted.many', { count: notices.length })}`;

      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-sp-pill',
          onClick: () => onOpen(newest.sessionId),
          title: newest.title,
        },
        h('span', { className: 'dsh-sp-dot', 'data-kind': kind }),
        h('span', null, clamp(count, 48)),
      );
    }

    /**
     * Root component mounted into `shell.overlay`.
     *
     * Reads the store through `useSyncExternalStore` and splits notices three
     * ways: the oldest unmuted decision drives the centred dialog, unmuted
     * completions stack in the corner, muted notices collapse into one pill.
     *
     * @param props - component props.
     * @returns the overlay layer.
     */
    function NoticeLayer({ store, t, onOpen, onDismiss, onOpenMuted }) {
      // The third argument is the server snapshot: the same read, so a static
      // render (and the test harness) works without a subscription. The browser
      // still tracks the live store through the first two.
      const notices = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

      const decisions = notices.filter((notice) => notice.kind === 'decision' && notice.muted !== true);
      const completions = notices.filter((notice) => notice.kind === 'completion' && notice.muted !== true);
      const muted = notices.filter((notice) => notice.muted === true);

      const stacked = completions.slice(Math.max(0, completions.length - MAX_COMPLETION_CARDS)).reverse();
      const active = decisions[0];

      return h(
        'div',
        { className: 'dsh-sp-layer' },
        active === undefined
          ? null
          : h(DecisionDialog, {
              key: active.id,
              notice: active,
              moreCount: decisions.length,
              t,
              onOpen,
              onDismiss,
            }),
        h(
          'div',
          { className: 'dsh-sp-corner' },
          muted.length === 0 ? null : h(MutedPill, { key: 'pill', notices: muted, t, onOpen: onOpenMuted }),
          stacked.map((notice) =>
            h(CompletionCard, { key: notice.id, notice, t, onOpen, onDismiss }),
          ),
        ),
      );
    }

    //#endregion

    return {
      inject: ['uiSession', 'sessions', 'uiWorkspace', 'slots', 'locale'],

      /**
       * Client plugin body: dictionaries, stylesheet, status triggers, and the
       * overlay registration.
       *
       * @param ctx - client root context.
       */
      apply(ctx) {
        // One store per activation; a reload disposes it with the effects below.
        const store = createStore();
        let serial = 0;

        const dismiss = (id) => store.remove(id);

        const openSession = (sessionId, noticeId) => {
          if (noticeId !== undefined) store.remove(noticeId);
          try {
            ctx.uiWorkspace?.openSession?.(sessionId);
          } catch {
            // A session that vanished between the alert and the click is not an
            // error worth surfacing: the notice is already gone.
          }
        };

        const openMuted = (sessionId) => {
          store.removeSession(sessionId);
          try {
            ctx.uiWorkspace?.openSession?.(sessionId);
          } catch {
            // Same as above.
          }
        };

        ctx.effect(() => {
          const en = ctx.locale.register(NS, 'en', COPY.en);
          const zh = ctx.locale.register(NS, 'zh', COPY.zh);
          return () => {
            zh?.();
            en?.();
          };
        }, 'dsh-session-popup: dictionaries');

        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.dshSessionPopup = '';
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'dsh-session-popup: styles');

        // The only writer: a Cordis effect on the shipped status snapshot. It
        // diffs edges and pushes notices into the store; nothing here touches
        // React, and React never writes back.
        ctx.effect(() => {
          const source = ctx.uiSession?.sessionStatus;
          if (source === undefined || typeof source.subscribe !== 'function') return undefined;

          let previous;

          const read = () => {
            const next = source.getSnapshot();

            // A decision notice is only meaningful while that interaction is
            // still open. Once the Host reports it settled — answered anywhere,
            // including in another window — the dialog must go away rather than
            // keep asking for an answer that was already given.
            store.removeWhere(
              (notice) =>
                notice.kind === 'decision' &&
                (next instanceof Map ? next.get(notice.sessionId)?.pendingInteraction : undefined) === undefined,
            );

            for (const edge of diffStatus(previous, next)) {
              // Subagent children never alert on their own; the parent session
              // is the one the user is actually working in.
              if (!isAlertableSession(ctx, edge.sessionId)) continue;

              // A completion for the session already on screen needs no alert:
              // the answer is right there in the conversation being read. Left
              // in, every single reply would raise a notice.
              if (edge.kind === 'completion' && isCurrentSession(ctx, edge.sessionId)) continue;

              if (edge.kind === 'decision') {
                // A new interaction on the same session supersedes the old one:
                // the Host would not report a second pending interaction while
                // the first was still open.
                store.removeWhere(
                  (notice) => notice.kind === 'decision' && notice.sessionId === edge.sessionId,
                );
              }
              serial += 1;
              store.add({
                id: `${edge.kind}:${edge.sessionId}:${serial}`,
                kind: edge.kind,
                sessionId: edge.sessionId,
                title: sessionTitle(ctx, edge.sessionId),
                detail: edge.kind === 'decision' ? interactionDetail(edge.interaction) : '',
                muted: isCurrentSession(ctx, edge.sessionId),
                createdAt: Date.now(),
              });
            }
            previous = next;
          };

          const unsubscribe = source.subscribe(read);
          read();
          return () => unsubscribe?.();
        }, 'dsh-session-popup: status triggers');

        // The Locale service binds `t` into every slot occupant; keep a bound
        // fallback so the layer still renders if a runtime omits the prop.
        const fallbackT = ctx.locale.bind(NS);
        const Layer = (props) =>
          h(NoticeLayer, {
            store,
            t: typeof props?.t === 'function' ? props.t : fallbackT,
            onOpen: openSession,
            onDismiss: dismiss,
            onOpenMuted: openMuted,
          });

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'session-popup', order: 40, locale: NS },
            Layer,
          ),
        );
      },
    };
  },
});
