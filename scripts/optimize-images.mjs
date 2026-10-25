// Image-optimization CLI: converts jpg/jpeg/png project images and the
// profile photo to WebP (long edge <= 1920, quality 82, metadata stripped,
// EXIF rotation baked in), moving the originals into original-images/
// (gitignored local archive). Runs the same pipeline the build embeds, so
// it can migrate a tree ahead of time; the build itself is a no-op fast
// path once nothing is convertible. Exit code 0 with "0 image(s)" when
// there is nothing to convert.
//
// Usage: node scripts/optimize-images.mjs [--root <repoRoot>]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverProjects } from "../src/lib/discover.ts";
import {
  checkCollisions,
  detectImageTool,
  nodeOptimizeDeps,
  nodeTextDeps,
  planProfileConversion,
  planProjectConversions,
  rewriteProfileImage,
  runConversions,
} from "../src/lib/optimize-images.ts";
import { validateProfile, validateProfileImageResolves } from "../src/lib/profile.ts";

function fail(messages) {
  for (const message of messages) console.error(`optimize error: ${message}`);
  console.error("optimize: failed.");
  process.exit(1);
}

// --- Argument parsing --------------------------------------------------------
const argv = process.argv.slice(2);
let root;
if (argv.length === 2 && argv[0] === "--root") root = argv[1];
else if (argv.length === 0) root = fileURLToPath(new URL("..", import.meta.url));
else fail(["Usage: node scripts/optimize-images.mjs [--root <repoRoot>]"]);
root = root.replace(/\/$/, "");

// --- 1. Profile configuration ------------------------------------------------
const profilePath = join(root, "content", "profile.json");
let rawProfile;
try {
  rawProfile = JSON.parse(readFileSync(profilePath, "utf8"));
} catch (error) {
  fail([
    error.code === "ENOENT"
      ? "Missing profile configuration at content/profile.json."
      : `content/profile.json is not valid JSON: ${error.message}`,
  ]);
}
const validated = validateProfile(rawProfile);
if (validated.errors.length > 0) fail(validated.errors);
const profile = validated.profile;
const imageErrors = validateProfileImageResolves(profile, (path) => existsSync(path), root);
if (imageErrors.length > 0) fail(imageErrors);

// --- 2. Discovery + conversion planning ---------------------------------------
const reader = {
  list: (dir) =>
    readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    })),
  readTextFile: (path) => readFileSync(path, "utf8"),
};
const discovered = discoverProjects(reader, join(root, "projects"));
if (discovered.errors.length > 0) fail(discovered.errors.map((issue) => issue.message));
for (const message of discovered.warnings.map((issue) => issue.message)) {
  console.warn(`optimize warning: ${message}`);
}

const archiveRoot = join(root, "original-images");
const plan = planProjectConversions(discovered.projects, join(root, "projects"), archiveRoot);
const profileConversion = planProfileConversion(profile.image, root, archiveRoot);
if (profileConversion !== null) plan.push(profileConversion);

// --- 3. Fast path --------------------------------------------------------------
if (plan.length === 0) {
  console.log("optimize: 0 image(s) to convert — every image is already WebP or another web format.");
  process.exit(0);
}

// --- 4. Convert ------------------------------------------------------------------
const tool = detectImageTool();
if (tool === null) {
  fail([
    "Image conversion is required (JPEG/PNG sources found) but ImageMagick was not found on PATH.",
    "Install it and retry: brew install imagemagick (macOS) or sudo apt-get install -y imagemagick (Ubuntu).",
  ]);
}
const collisions = checkCollisions(plan, { exists: existsSync });
if (collisions.length > 0) fail(collisions);
runConversions(plan, tool, nodeOptimizeDeps);
if (profileConversion !== null) {
  profile.image = rewriteProfileImage(profilePath, profile.image, nodeTextDeps);
  const errors = validateProfileImageResolves(profile, (path) => existsSync(path), root);
  if (errors.length > 0) fail(errors);
}

console.log(
  `optimize: converted ${plan.length} image(s) to WebP; originals archived under ${archiveRoot}.`,
);
