/// <reference types="vite/client" />

declare module "virtual:contract-artifacts" {
  interface BrowserContractArtifact {
    abi: readonly unknown[];
    bytecode: string;
  }

  export const ACTOR_REGISTRY_ARTIFACT: BrowserContractArtifact;
  export const GRAPE_TRACEABILITY_ARTIFACT: BrowserContractArtifact;
}

declare module "*?raw" {
  const content: string;
  export default content;
}
