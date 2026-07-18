import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

const sepoliaConfigured =
  Boolean(process.env.SEPOLIA_RPC_URL) && Boolean(process.env.SEPOLIA_PRIVATE_KEY);

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
    },
    ...(sepoliaConfigured
      ? {
          sepolia: {
            type: "http" as const,
            chainType: "l1" as const,
            url: process.env.SEPOLIA_RPC_URL as string,
            accounts: [process.env.SEPOLIA_PRIVATE_KEY as string],
          },
        }
      : {}),
  },
  test: {
    mocha: {
      timeout: 30_000,
    },
  },
});
