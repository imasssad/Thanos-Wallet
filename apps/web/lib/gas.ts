'use client';
/**
 * Makalu gas helper for the web app.
 *
 * The estimator now lives in @thanos/sdk-core (chains/gas.ts) so every
 * client shares it. This module is a thin web adapter: it reads
 * NEXT_PUBLIC_MAKALU_GAS_ORACLE_URL and injects it into the shared
 * estimator, then re-exports estimateMakaluGas.
 */
import { estimateMakaluGas, setGasOracleUrl, type MakaluGasEstimate } from '@thanos/sdk-core';

// If an Etherscan-style gas oracle is configured, wire it into the
// shared estimator. Runs once at module load.
const oracleUrl =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_MAKALU_GAS_ORACLE_URL) || '';
if (oracleUrl) setGasOracleUrl(String(oracleUrl));

export { estimateMakaluGas };
export type { MakaluGasEstimate };
