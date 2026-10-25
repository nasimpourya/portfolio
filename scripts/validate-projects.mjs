// Project-content validation CLI: validates content/profile.json (TASK-010)
// and discovers + validates everything under projects/ (TASK-006/007).
// Exit code 1 on any validation error, 0 otherwise.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverProjects } from "../src/lib/discover.ts";
import { validateProfile, validateProfileImageResolves } from "../src/lib/profile.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const projectsDir = join(repoRoot, "projects");
const profilePath = join(repoRoot, "content", "profile.json");

const errors = [];

// --- Profile configuration (TASK-010) ---
let rawProfile;
let profile;
try {
  rawProfile = JSON.parse(readFileSync(profilePath, "utf8"));
} catch (error) {
  if (error.code === "ENOENT") {
    errors.push(`Missing profile configuration at content/profile.json.`);
  } else {
    errors.push(`content/profile.json is not valid JSON: ${error.message}`);
  }
}
if (rawProfile !== undefined) {
  const validated = validateProfile(rawProfile);
  profile = validated.profile;
  errors.push(...validated.errors);
  if (profile) {
    errors.push(
      ...validateProfileImageResolves(
        profile,
        (path) => existsSync(path),
        repoRoot.replace(/\/$/, ""),
      ),
    );
  }
}

// --- Project discovery (TASK-006/007) ---
const reader = {
  list: (dir) =>
    readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    })),
  readTextFile: (path) => readFileSync(path, "utf8"),
};

const { projects, errors: discoveryErrors, warnings } = discoverProjects(reader, projectsDir);
errors.push(...discoveryErrors.map((issue) => issue.message));

for (const message of warnings.map((issue) => issue.message)) {
  console.warn(`warning: ${message}`);
}

if (errors.length > 0) {
  for (const message of errors) {
    console.error(`error: ${message}`);
  }
  console.error(`validate: ${errors.length} error(s) found.`);
  process.exit(1);
}

if (profile) {
  console.log(`validate: profile OK (${profile.name}).`);
}

if (projects.length === 0) {
  console.log("validate: no eligible projects found.");
} else {
  console.log(`validate: ${projects.length} project(s) discovered, all valid.`);
  for (const project of projects) {
    console.log(`  ${project.id} — "${project.description}" (${project.assets.length} gallery assets)`);
  }
}
