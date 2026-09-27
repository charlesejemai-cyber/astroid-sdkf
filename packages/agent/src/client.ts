/**
 * `AgentClient` — CRUD wrapper for the `/agents` resource.
 *
 * This module re-exports {@link AgentResource} under the `AgentClient` name so
 * callers can import the class using either naming convention:
 *
 * ```ts
 * import { AgentClient } from '@astroid/agent';
 * // or
 * import { AgentResource } from '@astroid/agent';
 * ```
 *
 * Both are identical; `AgentClient` is the name mentioned in the acceptance
 * criteria for issue #274.
 *
 * @module
 */

export { AgentResource as AgentClient } from './index.js';
