Fresh Grape Traceability PoC - Reproduction Instructions

Requirements:
- Node.js 22.13.0 or later
- pnpm 11 or later

Install and verify:
1. Open a terminal in this directory.
2. Run: pnpm install
3. Run: pnpm build
4. Run: pnpm test
5. Run: pnpm demo

The demo deploys ActorRegistry.sol and GrapeTraceability.sol to a local Hardhat
EVM, registers all five actor types, creates a grape batch, transfers custody,
runs the off-chain temperature oracle, stores detailed evidence off-chain,
submits hashes on-chain, records inspection evidence, recalls the batch, and
prints the final trace history.

Optional Sepolia deployment:
1. Set SEPOLIA_RPC_URL to a Sepolia RPC endpoint.
2. Set SEPOLIA_PRIVATE_KEY to a funded test-wallet private key.
3. Run: pnpm deploy:sepolia
4. The deployed addresses are written to addresses.txt.

Do not commit or submit any private key or .env file.

Clean submission:
Include source code, tests, package.json, pnpm-lock.yaml, pnpm-workspace.yaml,
hardhat.config.ts, tsconfig.json, readme.txt, addresses.txt, and presentation
slides. Exclude node_modules, artifacts, cache, generated-types, deployment
runtime JSON, offchain-storage/generated, and .env files.
