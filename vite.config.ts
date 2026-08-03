import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";

const artifactsModuleId = "virtual:contract-artifacts";
const resolvedArtifactsModuleId = `\0${artifactsModuleId}`;

function contractArtifactsPlugin() {
  return {
    name: "fresh-grape-contract-artifacts",
    resolveId(id: string) {
      return id === artifactsModuleId ? resolvedArtifactsModuleId : undefined;
    },
    load(id: string) {
      if (id !== resolvedArtifactsModuleId) return undefined;

      const loadArtifact = (contractName: string) => {
        const artifactPath = path.join(
          process.cwd(),
          "artifacts",
          "contracts",
          `${contractName}.sol`,
          `${contractName}.json`,
        );
        try {
          const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
            abi: unknown[];
            bytecode: string;
          };
          return { abi: artifact.abi, bytecode: artifact.bytecode };
        } catch {
          throw new Error(
            `Missing ${contractName} build artifact. Run \"pnpm build\" before starting the frontend.`,
          );
        }
      };

      const actorRegistry = loadArtifact("ActorRegistry");
      const grapeTraceability = loadArtifact("GrapeTraceability");
      return [
        `export const ACTOR_REGISTRY_ARTIFACT = ${JSON.stringify(actorRegistry)};`,
        `export const GRAPE_TRACEABILITY_ARTIFACT = ${JSON.stringify(grapeTraceability)};`,
      ].join("\n");
    },
  };
}

export default defineConfig({
  plugins: [react(), contractArtifactsPlugin()],
  publicDir: "frontend/public",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: "dist/frontend",
    emptyOutDir: true,
  },
});
