import { execFileSync } from "node:child_process";

const bannedPatterns = [
  /^node_modules\//,
  /^artifacts\//,
  /^cache\//,
  /^out\//,
  /^dist\//,
  /^broadcast\//,
  /^typechain(?:-types)?\//,
  /^generated-types\//,
  /^\.env(?:\.|$)/,
];

const trackedFiles = execFileSync("git", ["ls-files"], {
  encoding: "utf8",
}).split(/\r?\n/).filter(Boolean);

const bannedFiles = trackedFiles.filter((file) =>
  bannedPatterns.some((pattern) => pattern.test(file)),
);

if (bannedFiles.length > 0) {
  console.error("Submission check failed. Remove these generated or secret files:");
  for (const file of bannedFiles) console.error(`- ${file}`);
  process.exitCode = 1;
} else {
  console.log(`Submission check passed: ${trackedFiles.length} tracked source files, no banned artifacts.`);
}
