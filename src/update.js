/** Version check against the npm registry (pure helpers + one fetch). */
const https = require("https");

const REGISTRY_URL = "https://registry.npmjs.org/piramyd/latest";

function parseVersion(value) {
  const match = String(value || "").trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return { major: +match[1], minor: +match[2], patch: +match[3], pre: match[4] || "" };
}

/** -1 if a < b, 0 if equal, 1 if a > b; null when either is not semver. */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (const key of ["major", "minor", "patch"]) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1; // a release outranks its own prerelease
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

function fetchLatestVersion(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(REGISTRY_URL, { headers: { Accept: "application/json", "User-Agent": "piramyd-toolkit" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`npm registry answered HTTP ${res.statusCode}`));
        try {
          const version = JSON.parse(body).version;
          if (!parseVersion(version)) throw new Error("no version in registry response");
          resolve(String(version));
        } catch (err) {
          reject(new Error(`unreadable registry response: ${err.message}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
  });
}

module.exports = { parseVersion, compareVersions, fetchLatestVersion };
