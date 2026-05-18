/**
 * Canonical LEP100 token ABI — the only ABI the indexer uses for every
 * LEP100 contract. Replaces the partial hand-written fragment that used
 * to live in chain.ts.
 *
 * LEP100 = standard ERC-20 (ERC20 + IERC20Metadata) + ERC20Burnable
 * (burn / burnFrom) + Ownable (owner / transferOwnership /
 * renounceOwnership). Nothing custom.
 *
 * Source of truth:
 *   contracts/artifacts/contracts/LEP100Token.sol/LEP100Token.json
 *
 * This module is the indexer-side mirror of that artifact's `abi`
 * field. The indexer is Dockerised from services/indexer and can't
 * import a file outside its own tree, so the canonical artifact is
 * mirrored here in ethers human-readable form. If the contract
 * changes, regenerate this list from the artifact.
 */
export const LEP100_ABI = [
  // ─── ERC-20 ─────────────────────────────────────────────────────────
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  // ─── ERC20Burnable ──────────────────────────────────────────────────
  'function burn(uint256 amount)',
  'function burnFrom(address account, uint256 amount)',
  // ─── Ownable ────────────────────────────────────────────────────────
  'function owner() view returns (address)',
  'function transferOwnership(address newOwner)',
  'function renounceOwnership()',
  // ─── Events ─────────────────────────────────────────────────────────
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)',
] as const;
