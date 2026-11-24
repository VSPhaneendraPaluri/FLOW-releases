'use strict';

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const { spawn } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '4mb' }));

// ── Environment ────────────────────────────────────────────────────────────
const isWin = process.platform === 'win32';

// ── Paths ──────────────────────────────────────────────────────────────────
const RUNTIME_DIR        = path.join(__dirname, 'sdk_runtime');
const SDK_VERSION_MARKER = path.join(RUNTIME_DIR, '.sdk_version_tag');
let   SDK_ROOT           = null;
let   SDK_VERSION        = 'unknown';   // human-readable release tag, e.g. "0.9.0"
let   SDK_API_VERSION    = 'unknown';   // internal ABI constant from types.hpp, e.g. "0x00000900"
let   SDK_RELEASE_DATE   = null;        // ISO 8601 published_at from GitHub
let   SDK_RELEASE_ASSET  = null;        // zip filename that was downloaded
let   SDK_UPDATE_AVAILABLE = null;      // set to newer tag string when a newer release is detected

// ── Binary detection ───────────────────────────────────────────────────────
let FLOW_BIN  = null;
let VALID_BIN = null;

function findBinary(root, candidates) {
    const binDir = path.join(root, 'bin');
    if (!fs.existsSync(binDir)) return null;
    for (const c of candidates) {
        const p = path.join(binDir, c);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function detectBinaries() {
    FLOW_BIN = findBinary(SDK_ROOT, isWin
        ? ['flow-cli-windows-x86_64.exe', 'flow.exe', 'flow-cli.exe']
        : ['flow-cli-linux-x86_64', 'flow-linux-x86_64', 'flow-cli', 'flow']);
    VALID_BIN = findBinary(SDK_ROOT, isWin
        ? ['flow-validate-windows-x86_64.exe', 'flow_validate.exe', 'flow-validate.exe']
        : ['flow-validate-linux-x86_64', 'flow-validate', 'flow_validate']);
    if (!isWin) {
        [FLOW_BIN, VALID_BIN].filter(Boolean).forEach(b => {
            try { fs.chmodSync(b, 0o755); } catch {}
        });
    }
}

function detectVersion() {
    // Read the internal ABI version constant from types.hpp.
    // This is a packed uint32 (major:16 | minor:8 | patch:8), e.g. 0x00000900 = 0.9.0.
    // It is stored separately as SDK_API_VERSION and is NOT used as the display version.
    // The human-readable release tag (SDK_VERSION) is set by the caller from the GitHub
    // release metadata or the ZIP filename before this function is called.
    SDK_API_VERSION = 'unknown';
    const vFile = path.join(SDK_ROOT, 'include', 'flow', 'isa', 'types.hpp');
    if (!fs.existsSync(vFile)) return;
    try {
        const src = fs.readFileSync(vFile, 'utf8');
        const m   = src.match(/FLOW_ISA_API_VERSION\s*=\s*(0x[0-9A-Fa-f]+|[0-9]+)/);
        if (m) {
            SDK_API_VERSION = m[1];
            // Decode packed version as a fallback display version only if no tag was set.
            if (SDK_VERSION === 'unknown') {
                const v = parseInt(m[1], 16);
                if (!isNaN(v)) {
                    const major = (v >>> 16) & 0xFFFF;
                    const minor = (v >>>  8) & 0x00FF;
                    const patch =  v         & 0x00FF;
                    SDK_VERSION = `${major}.${minor}.${patch}`;
                }
            }
        }
    } catch {}
}

// ── ZIP extractor ──────────────────────────────────────────────────────────
function extractZipBuffer(buf) {
    const AdmZip = require('adm-zip');
    if (fs.existsSync(RUNTIME_DIR)) fs.rmSync(RUNTIME_DIR, { recursive: true });
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    new AdmZip(buf).extractAllTo(RUNTIME_DIR, true);

    // Flatten single top-level folder (e.g. flow-sdk-0.1.0/)
    const entries = fs.readdirSync(RUNTIME_DIR);
    if (entries.length === 1) {
        const inner = path.join(RUNTIME_DIR, entries[0]);
        if (fs.statSync(inner).isDirectory()) {
            for (const item of fs.readdirSync(inner))
                fs.renameSync(path.join(inner, item), path.join(RUNTIME_DIR, item));
            fs.rmdirSync(inner);
        }
    }
    SDK_ROOT = RUNTIME_DIR;
    detectVersion();
    detectBinaries();
    // Write a version marker so the restart-reuse path can compare against GitHub.
    try { fs.writeFileSync(SDK_VERSION_MARKER, SDK_VERSION, 'utf8'); } catch {}
}

// ── HTTP download (follows redirects) ─────────────────────────────────────
function download(url, token, redirects = 0) {
    if (redirects > 5) return Promise.reject(new Error('Too many redirects'));
    return new Promise((resolve, reject) => {
        const https = require('https');
        const parsed = new URL(url);
        const opts = {
            hostname : parsed.hostname,
            path     : parsed.pathname + parsed.search,
            headers  : {
                'User-Agent': 'flow-sdk-playground/1.0',
                'Accept'    : 'application/octet-stream',
            },
            timeout: 120_000,
        };
        if (token) opts.headers['Authorization'] = `Bearer ${token}`;
        const req = https.get(opts, res => {
            const { statusCode, headers } = res;
            if (statusCode >= 300 && statusCode < 400 && headers.location)
                return resolve(download(headers.location, '', redirects + 1));
            if (statusCode !== 200)
                return reject(new Error(`HTTP ${statusCode} from ${url}`));
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end',  ()  => resolve(Buffer.concat(chunks)));
        });
        req.on('error',   reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Download timed out')); });
    });
}

// ── Loader: local file (Windows dev) ──────────────────────────────────────
function loadFromPath(zipPath) {
    console.log(`[sdk] Loading from path: ${zipPath}`);
    // Pre-set version from filename so detectVersion() doesn't overwrite it.
    const mName = path.basename(zipPath).match(/flow-sdk-v?(\d+\.\d+\.\d+)/i);
    SDK_VERSION       = mName ? mName[1] : 'unknown';
    SDK_RELEASE_DATE  = null;
    SDK_RELEASE_ASSET = path.basename(zipPath);
    extractZipBuffer(fs.readFileSync(zipPath));
    console.log(`[sdk] Loaded. version=${SDK_VERSION} apiVersion=${SDK_API_VERSION}`);
}

// ── Loader: GitHub latest release ─────────────────────────────────────────
async function loadFromGitHub() {
    const https = require('https');
    const OWNER = process.env.GITHUB_OWNER;
    const REPO  = process.env.GITHUB_REPO  || 'FLOW-releases';
    const TOKEN = process.env.GITHUB_TOKEN || '';
    if (!OWNER) throw new Error('GITHUB_OWNER env var not set');

    function apiGet(apiPath) {
        return new Promise((resolve, reject) => {
            const opts = {
                hostname: 'api.github.com',
                path    : apiPath,
                headers : {
                    'User-Agent'          : 'flow-sdk-playground/1.0',
                    'Accept'              : 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
                timeout: 15_000,
            };
            if (TOKEN) opts.headers['Authorization'] = `Bearer ${TOKEN}`;
            const req = https.get(opts, res => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end',  () => resolve({ status: res.statusCode,
                                               body: Buffer.concat(chunks) }));
            });
            req.on('error',   reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('GitHub API timeout')); });
        });
    }

    console.log(`[sdk] Fetching latest release from GitHub: ${OWNER}/${REPO}`);
    const { status, body } = await apiGet(`/repos/${OWNER}/${REPO}/releases/latest`);
    if (status !== 200) {
        console.error(`[sdk] GitHub API ${status}:`, body.toString().slice(0, 200));
        throw new Error(`GitHub API returned ${status}`);
    }

    const release = JSON.parse(body.toString());
    const assets  = release.assets || [];

    // Prefer platform-matched ZIP; fall back to any ZIP
    const platformKey = isWin ? 'windows' : 'linux';
    let asset = assets.find(a => a.name.endsWith('.zip') && a.name.includes(platformKey));
    if (!asset) asset = assets.find(a => a.name.endsWith('.zip'));
    if (!asset) throw new Error('No ZIP asset found in latest release');

    // Capture human-readable release metadata BEFORE extracting the ZIP.
    // tag_name is always present (e.g. "v0.9.0") and is the canonical display version.
    // Strip the leading "v" for consistency with semver display expectations.
    SDK_VERSION       = (release.tag_name || 'unknown').replace(/^v/, '');
    SDK_RELEASE_DATE  = release.published_at || null;
    SDK_RELEASE_ASSET = asset.name;

    console.log(`[sdk] Downloading asset: ${asset.name} (${(asset.size / 1e6).toFixed(1)} MB)`);
    const buf = await download(asset.browser_download_url, TOKEN);
    extractZipBuffer(buf);
    console.log(`[sdk] Ready. version=${SDK_VERSION} apiVersion=${SDK_API_VERSION} released=${SDK_RELEASE_DATE}`);
}

// ── Loader: explicit URL ───────────────────────────────────────────────────
async function loadFromUrl(url) {
    console.log(`[sdk] Downloading: ${url}`);
    const buf = await download(url, process.env.GITHUB_TOKEN || '');
    extractZipBuffer(buf);
    console.log(`[sdk] Ready. version=${SDK_VERSION}`);
}

// ── Lightweight GitHub version check (no download) ────────────────────────
// Returns the latest release tag_name (e.g. "v0.9.0") without downloading the ZIP.
async function fetchLatestTag() {
    const https  = require('https');
    const OWNER  = process.env.GITHUB_OWNER;
    const REPO   = process.env.GITHUB_REPO  || 'FLOW-releases';
    const TOKEN  = process.env.GITHUB_TOKEN || '';
    if (!OWNER) return null;

    return new Promise((resolve, reject) => {
        const opts = {
            hostname: 'api.github.com',
            path    : `/repos/${OWNER}/${REPO}/releases/latest`,
            headers : {
                'User-Agent'          : 'flow-sdk-playground/1.0',
                'Accept'              : 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
            timeout: 10_000,
        };
        if (TOKEN) opts.headers['Authorization'] = `Bearer ${TOKEN}`;
        const req = https.get(opts, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try {
                    const r = JSON.parse(Buffer.concat(chunks).toString());
                    resolve(r.tag_name || null);
                } catch { resolve(null); }
            });
        });
        req.on('error',   reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

// ── Periodic auto-update check ────────────────────────────────────────────
// Runs every 6 hours on Render. If a newer GitHub release exists, re-fetches the SDK.
// This keeps a long-running instance current without requiring a re-deploy.
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function checkForUpdate() {
    if (!process.env.GITHUB_OWNER) return; // only on Render / cloud
    try {
        const latestTag   = await fetchLatestTag();
        const latestClean = (latestTag || '').replace(/^v/, '');
        if (!latestClean || latestClean === SDK_VERSION) {
            SDK_UPDATE_AVAILABLE = null; // already on latest
            return;
        }
        // Don't auto-reload — set a flag so the UI can show a "new version" banner.
        // The user can then click "Reload SDK" to apply it without disrupting in-flight runs.
        if (SDK_UPDATE_AVAILABLE !== latestClean) {
            console.log(`[sdk] New release available: ${SDK_VERSION} → ${latestClean}`);
            SDK_UPDATE_AVAILABLE = latestClean;
        }
    } catch (e) {
        console.warn('[sdk] Update check failed:', e.message);
    }
}

// ── Startup ────────────────────────────────────────────────────────────────
async function startup() {
    try {
        // 1. Explicit env var (any platform)
        const localZip = process.env.SDK_ZIP_PATH
            || (() => {
                // Windows dev only: scan parent dir for any *.zip
                if (!isWin) return null;
                try {
                    const parent = path.join(__dirname, '..');
                    const zips = fs.readdirSync(parent)
                        .filter(f => f.toLowerCase().endsWith('.zip'))
                        .map(f => path.join(parent, f));
                    return zips[0] || null;
                } catch { return null; }
            })();

        if (localZip) {
            // Local dev: load from ZIP on disk
            console.log(`[sdk] Auto-detected local ZIP: ${localZip}`);
            loadFromPath(localZip);
        } else if (process.env.GITHUB_OWNER) {
            // Render (or any cloud): fetch from GitHub releases.
            // If sdk_runtime/ already exists (container restart without redeploy),
            // check whether a newer release is available on GitHub before reusing.
            if (fs.existsSync(RUNTIME_DIR) && fs.existsSync(SDK_VERSION_MARKER)) {
                const storedTag = fs.readFileSync(SDK_VERSION_MARKER, 'utf8').trim();
                try {
                    const latestTag = await fetchLatestTag();
                    const latestClean = (latestTag || '').replace(/^v/, '');
                    if (storedTag && storedTag === latestClean) {
                        // Same version — safe to reuse, no need to re-download.
                        SDK_ROOT = RUNTIME_DIR;
                        SDK_VERSION = storedTag;
                        detectVersion();
                        detectBinaries();
                        console.log(`[sdk] Reusing sdk_runtime/ — already at latest (${SDK_VERSION})`);
                    } else {
                        console.log(`[sdk] Newer release detected (${storedTag} → ${latestClean}). Re-fetching…`);
                        await loadFromGitHub();
                    }
                } catch (checkErr) {
                    // If the version check fails, re-fetch to be safe.
                    console.warn(`[sdk] Version check failed (${checkErr.message}). Re-fetching from GitHub…`);
                    await loadFromGitHub();
                }
            } else {
                await loadFromGitHub();
            }
        } else if (fs.existsSync(RUNTIME_DIR)) {
            // Local dev restart without a ZIP: reuse extracted runtime as-is.
            SDK_ROOT = RUNTIME_DIR;
            const storedTag = fs.existsSync(SDK_VERSION_MARKER)
                ? fs.readFileSync(SDK_VERSION_MARKER, 'utf8').trim() : null;
            if (storedTag) SDK_VERSION = storedTag;
            detectVersion();
            detectBinaries();
            console.log(`[sdk] Reusing sdk_runtime/ (version=${SDK_VERSION})`);
        } else {
            // No SDK source — serve UI only; Run/Validate unavailable
            SDK_ROOT = path.join(__dirname, 'sdk_stub');
            fs.mkdirSync(SDK_ROOT, { recursive: true });
            console.warn('[sdk] No SDK source found. UI loaded but Run/Validate unavailable.');
        }
    } catch (e) {
        console.error('[sdk] Startup load failed:', e.message);
        // Don't crash — keep serving the UI; operator can re-trigger via /api/load-sdk
        if (!SDK_ROOT) {
            SDK_ROOT = path.join(__dirname, 'sdk_stub');
            fs.mkdirSync(SDK_ROOT, { recursive: true });
        }
    }

    console.log(`\n  SDK root      : ${SDK_ROOT}`);
    console.log(`  SDK version   : ${SDK_VERSION}`);
    console.log(`  SDK API ver   : ${SDK_API_VERSION}`);
    console.log(`  Released      : ${SDK_RELEASE_DATE || '(unknown)'}`);
    console.log(`  Asset         : ${SDK_RELEASE_ASSET || '(unknown)'}`);
    console.log(`  flow binary   : ${FLOW_BIN  || '(not found)'}`);
    console.log(`  validate      : ${VALID_BIN || '(not found)'}\n`);

    // Start periodic auto-update check (Render / cloud only).
    if (process.env.GITHUB_OWNER) {
        setInterval(checkForUpdate, AUTO_CHECK_INTERVAL_MS);
        console.log(`[sdk] Auto-update check scheduled every ${AUTO_CHECK_INTERVAL_MS / 3600000}h`);
    }
}

// ── API: health check (used by Render) ────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── API: status ────────────────────────────────────────────────────────────
app.get('/api/status', (_req, res) => res.json({
    sdkVersion      : SDK_VERSION,          // human-readable release tag, e.g. "0.9.0"
    sdkApiVersion   : SDK_API_VERSION,      // packed ABI constant from types.hpp, e.g. "0x00000900"
    sdkReleaseDate  : SDK_RELEASE_DATE,     // ISO 8601 published_at, e.g. "2025-04-01T00:00:00Z"
    sdkAsset        : SDK_RELEASE_ASSET,    // zip filename, e.g. "flow-sdk-0.9.0-linux-x86_64.zip"
    sdkRoot         : SDK_ROOT ? path.basename(SDK_ROOT) : null,
    flowBin         : FLOW_BIN  ? path.basename(FLOW_BIN)  : null,
    validateBin     : VALID_BIN ? path.basename(VALID_BIN) : null,
    canRun          : !!FLOW_BIN,
    canValidate     : !!(VALID_BIN || FLOW_BIN),
    platform        : process.platform,
    updateAvailable : SDK_UPDATE_AVAILABLE, // non-null when a newer GitHub release exists
}));

// ── API: load SDK (path | url | github) ───────────────────────────────────
app.post('/api/load-sdk', async (req, res) => {
    const { type, value } = req.body;
    try {
        if (type === 'path') {
            if (!value) return res.status(400).json({ error: 'Missing value' });
            loadFromPath(value);
        } else if (type === 'url') {
            if (!value) return res.status(400).json({ error: 'Missing value' });
            await loadFromUrl(value);
        } else if (type === 'github') {
            await loadFromGitHub();
        } else {
            return res.status(400).json({ error: 'type must be path | url | github' });
        }
        SDK_UPDATE_AVAILABLE = null; // clear banner — user has just loaded the latest
        res.json({
            ok: true, sdkVersion: SDK_VERSION,
            canRun: !!FLOW_BIN, canValidate: !!(VALID_BIN || FLOW_BIN),
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── API: upload plugin (.so / .dll / .dylib) ──────────────────────────────
// Accepts raw binary body. Saves to sdk_runtime/plugins/<filename>.
// Returns the rel path so the UI can add it to the plugin dropdown immediately.
app.post('/api/upload-plugin', (req, res) => {
    if (!SDK_ROOT) return res.status(503).json({ error: 'SDK not loaded' });
    const name = (req.headers['x-plugin-name'] || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!name) return res.status(400).json({ error: 'Missing X-Plugin-Name header' });
    const exts = ['.so', '.dll', '.dylib'];
    if (!exts.some(x => name.toLowerCase().endsWith(x)))
        return res.status(400).json({ error: 'File must be .so, .dll, or .dylib' });

    const pluginsDir = path.join(SDK_ROOT, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    const dest = path.join(pluginsDir, name);
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
        try {
            const buf = Buffer.concat(chunks);
            if (buf.length === 0) return res.status(400).json({ error: 'Empty file' });
            if (buf.length > 32 * 1024 * 1024)
                return res.status(413).json({ error: 'Plugin too large (max 32 MB)' });
            fs.writeFileSync(dest, buf);
            if (!isWin) { try { fs.chmodSync(dest, 0o755); } catch {} }
            const rel = path.relative(SDK_ROOT, dest);
            console.log(`[plugin] Uploaded: ${name} (${(buf.length / 1e3).toFixed(0)} KB)`);
            res.json({ ok: true, name, rel });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    req.on('error', e => res.status(500).json({ error: e.message }));
});

// ── API: tree ──────────────────────────────────────────────────────────────
function buildTree(dir, relBase) {
    const result = [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return result; }
    for (const e of entries) {
        const rel = relBase ? `${relBase}/${e.name}` : e.name;
        if (e.isDirectory()) {
            result.push({ type: 'dir',  name: e.name, path: rel,
                          children: buildTree(path.join(dir, e.name), rel) });
        } else {
            result.push({ type: 'file', name: e.name, path: rel });
        }
    }
    return result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}

app.get('/api/tree', (_req, res) => {
    if (!SDK_ROOT) return res.status(503).json({ error: 'SDK not loaded' });
    try { res.json({ tree: buildTree(SDK_ROOT, ''), version: SDK_VERSION }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: file read ─────────────────────────────────────────────────────────
function resolveSafe(rel) {
    if (!rel || !SDK_ROOT) return null;
    const root = path.resolve(SDK_ROOT);
    const abs  = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep) && abs !== root) return null;
    return abs;
}

app.get('/api/file', (req, res) => {
    const abs = resolveSafe(req.query.path);
    if (!abs) return res.status(403).json({ error: 'Forbidden' });
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory())
        return res.status(404).json({ error: 'Not found' });
    try { res.json({ path: req.query.path, content: fs.readFileSync(abs, 'utf8') }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: file save ─────────────────────────────────────────────────────────
app.post('/api/save', (req, res) => {
    const { path: rel, content } = req.body;
    if (typeof content !== 'string')
        return res.status(400).json({ error: 'Missing content' });
    const abs = resolveSafe(rel);
    if (!abs) return res.status(403).json({ error: 'Forbidden' });
    try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: plugins ───────────────────────────────────────────────────────────
app.get('/api/plugins', (_req, res) => {
    if (!SDK_ROOT) return res.json({ plugins: [] });
    const exts = isWin ? ['.dll'] : ['.so', '.dylib'];
    const found = [];
    function scan(dir) {
        if (!fs.existsSync(dir)) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) scan(full);
            else if (exts.some(x => e.name.endsWith(x)))
                found.push({ name: e.name, abs: full,
                             rel: path.relative(SDK_ROOT, full) });
        }
    }
    scan(SDK_ROOT);
    res.json({ plugins: found });
});

// ── SSE helpers ────────────────────────────────────────────────────────────
function sseStart(res) {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();
}
const sseMsg  = (res, type, text) =>
    res.write(`data: ${JSON.stringify({ type, text })}\n\n`);
const sseDone = (res, code) => {
    res.write(`data: ${JSON.stringify({ type: 'exit', code })}\n\n`);
    res.end();
};

// ── Temp file helper ──────────────────────────────────────────────────────
// Write the temp script adjacent to the original file when possible,
// so relative `use "foo.rules"` paths resolve correctly.

function findFileInSdk(dir, name) {
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const found = findFileInSdk(full, name);
                if (found) return found;
            } else if (entry.name === name) return full;
        }
    } catch {}
    return null;
}

function writeTempScript(content, scriptPath, prefix) {
    // 1. Prefer adjacent to the original SDK file (scriptPath provided by client)
    if (scriptPath && SDK_ROOT) {
        const dir = path.join(SDK_ROOT, path.dirname(scriptPath));
        if (fs.existsSync(dir)) {
            const tmp = path.join(dir, `${prefix}_${Date.now()}.flow`);
            fs.writeFileSync(tmp, content, 'utf8');
            return tmp;
        }
    }
    // 2. Script uses a relative file (*.rules or *.flow) — find it in the SDK
    //    and write the temp file adjacent to it so relative `use` paths resolve.
    if (SDK_ROOT) {
        const m = content.match(/use\s+"([^"]+\.(rules|flow))"/);
        if (m) {
            const refName = path.basename(m[1]);
            const found = findFileInSdk(SDK_ROOT, refName);
            if (found) {
                const tmp = path.join(path.dirname(found), `${prefix}_${Date.now()}.flow`);
                fs.writeFileSync(tmp, content, 'utf8');
                return tmp;
            }
        }
    }
    // 3. Fallback: /tmp (absolute path passed to binary)
    const tmp = path.join(os.tmpdir(), `${prefix}_${Date.now()}.flow`);
    fs.writeFileSync(tmp, content, 'utf8');
    return tmp;
}

// ── API: run ───────────────────────────────────────────────────────────────
app.post('/api/run', (req, res) => {
    sseStart(res);
    if (!FLOW_BIN) {
        sseMsg(res, 'stderr', 'No FLOW binary found in sdk/bin/.\n');
        return sseDone(res, 1);
    }
    const { script, pluginPath, scriptPath } = req.body;
    if (!script) { sseMsg(res, 'stderr', 'No script content.\n'); return sseDone(res, 1); }

    const tmp = writeTempScript(script, scriptPath, '_flow_run');
    const cwd = path.dirname(tmp);

    const args = [];
    if (pluginPath) {
        args.push('--plugin', path.isAbsolute(pluginPath)
            ? pluginPath : path.join(SDK_ROOT, pluginPath));
    }
    args.push(tmp);

    sseMsg(res, 'info',
        `$ ${path.basename(FLOW_BIN)} ${args.map(a => path.basename(a)).join(' ')}\n`);

    const proc = spawn(FLOW_BIN, args, { cwd });
    proc.stdout.on('data', d => sseMsg(res, 'stdout', d.toString()));
    proc.stderr.on('data', d => sseMsg(res, 'stderr', d.toString()));
    proc.on('error', e => { sseMsg(res, 'stderr', `Error: ${e.message}\n`); sseDone(res, -1); });
    proc.on('close', code => {
        try { fs.unlinkSync(tmp); } catch {}
        sseMsg(res, code === 0 ? 'info' : 'stderr', `\n[Exited with code ${code}]\n`);
        sseDone(res, code);
    });
    res.on('close', () => { try { proc.kill(); } catch {} });
});

// ── API: validate ──────────────────────────────────────────────────────────
app.post('/api/validate', (req, res) => {
    sseStart(res);
    if (!FLOW_BIN && !VALID_BIN) {
        sseMsg(res, 'stderr', 'No FLOW binary found.\n'); return sseDone(res, 1);
    }
    const { script, pluginPath, scriptPath } = req.body;
    const tmp = writeTempScript(script || '', scriptPath, '_flow_val');
    const cwd = path.dirname(tmp);

    const bin  = VALID_BIN || FLOW_BIN;
    // flow-validate takes just the script; flow-cli has no --validate flag —
    // run the script normally (parse + ISA check) using the same plugin the
    // Run panel would use, then treat any non-zero exit as a validation error.
    const args = [];
    if (!VALID_BIN && pluginPath) {
        args.push('--plugin', path.isAbsolute(pluginPath)
            ? pluginPath : path.join(SDK_ROOT, pluginPath));
    }
    args.push(tmp);
    sseMsg(res, 'info',
        `$ ${path.basename(bin)} ${args.map(a => path.basename(a)).join(' ')}\n`);

    const proc = spawn(bin, args, { cwd });
    proc.stdout.on('data', d => sseMsg(res, 'stdout', d.toString()));
    proc.stderr.on('data', d => sseMsg(res, 'stderr', d.toString()));
    proc.on('error', e => { sseMsg(res, 'stderr', `Error: ${e.message}\n`); sseDone(res, -1); });
    proc.on('close', code => {
        try { fs.unlinkSync(tmp); } catch {}
        sseMsg(res, code === 0 ? 'info' : 'stderr', `\n[Exited with code ${code}]\n`);
        sseDone(res, code);
    });
    res.on('close', () => { try { proc.kill(); } catch {} });
});

// ── Static ─────────────────────────────────────────────────────────────────
app.use(express.static(__dirname));
app.get(/.*/, (_req, res) =>
    res.sendFile(path.join(__dirname, 'index.html')));

// ── Graceful shutdown (SIGTERM from Render on deploy / scale-down) ─────────
let server;
function shutdown(signal) {
    console.log(`\n[server] ${signal} received — shutting down gracefully`);
    server.close(() => {
        console.log('[server] Closed. Goodbye.');
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Boot ───────────────────────────────────────────────────────────────────
startup().then(() => {
    server = app.listen(PORT, '0.0.0.0', () =>
        console.log(`  FLOW SDK Playground → http://localhost:${PORT}\n`));
}).catch(e => {
    console.error('Fatal startup error:', e);
    process.exit(1);
});
