/**
 * Portfolio value history for the dashboard chart.
 *
 * The implementation is shared across all clients in @thanos/sdk-core;
 * this module just re-exports it so existing web imports keep working.
 */
export {
  fetchPortfolioHistory,
  PORTFOLIO_HISTORY_POINTS,
  type Holding,
  type Range,
  type PortfolioHistory,
} from '@thanos/sdk-core';
