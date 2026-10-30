/**
 * Host half of `@satanfire/dsh-session-popup`.
 *
 * This half owns no behaviour, on purpose. Every trigger is a Client fact
 * (`uiSession.sessionStatus`: a pending decision appearing, a run going
 * running → idle), and every surface is a Client Slot (`shell.overlay`). A
 * Node process cannot draw a popup, so there is nothing here to do.
 *
 * The row still has to exist. The Client module scanner reads `dsh.client`
 * from the manifest of the package a Loader row mounts; mounting this package
 * is what makes `./client.js` reach the browser. That is the whole job.
 *
 * @module @satanfire/dsh-session-popup
 */

/**
 * Diagnostic name of this Host plugin, used in logs and disposal labels.
 *
 * It is deliberately not the Loader row id: the row in `cordis.patch.yml` is
 * the shorter `session-popup`, and patch layers target that id. This name is
 * only what the plugin reports about itself.
 */
export const name = 'dsh-session-popup';

/**
 * Mount hook. Intentionally empty — see the module note above.
 *
 * Declared rather than omitted so the Loader sees a normal, complete plugin
 * instead of inferring one from a side-effect import.
 */
export function apply() {}
