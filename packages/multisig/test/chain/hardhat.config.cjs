// Local chain for the Thanos MultiSig tests. Nothing is compiled here: the Litho Vault contracts
// come pre-built from ../fixtures/litho-vault-contracts.json.
module.exports = {
  paths: { sources: './no-sources', cache: './.hardhat-cache', artifacts: './.hardhat-artifacts' },
  networks: { hardhat: { chainId: 31337 } },
};
