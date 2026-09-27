/**
 * `BudgetsResource` — budget CRUD and allocation tracking built directly on the
 * core {@link Resource} layer.
 *
 * This mirrors the surface of {@link BudgetClient} but is wired to the shared
 * `HttpClient` handed to every SDK resource namespace, so `astroid.budgets`
 * behaves like the other namespaces (`wallets`, `agents`, …).
 *
 * @module
 */

export {
  BudgetResource,
  BudgetsResource,
  type BudgetListParams,
} from './index.js';
