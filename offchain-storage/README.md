# Off-chain storage component

This directory represents a file-backed evidence store for the PoC. The oracle
copies detailed temperature logs and computed summaries into `generated/` at
runtime. Only SHA-256 hashes, a short summary hash, and an `offchain://` URI are
submitted to the smart contract.

`generated/` is intentionally ignored by Git because it is runtime data. A
production architecture can replace `FileEvidenceStore` with IPFS, cloud object
storage, or a shared database without changing the contract interface.
