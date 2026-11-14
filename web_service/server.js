'use strict';

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const { spawn } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '4mb' }));

// ── Paths ──────────────────────────────────────────────────────────────────
const BUNDLED_DIR = path.join(__dirname, 'sdk');
const RUNTIME_DIR = path.join(__dirname, 'sdk_runtime');
let   SDK_ROOT    = BUNDLED_DIR;
let   SDK_VERSION = 'local';

const isWin = process.platform === 'win32';

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
    SDK_VERSION = 'local';
    const vFile = path.join(SDK_ROOT, 'include', 'flow', 'isa', 'types.hpp');
    if (!fs.existsSync(vFile)) return;
    try {
        const src = fs.readFileSync(vFile, 'utf8');
        const m = src.match(/FLOW_ISA_API_VERSION\s*=\s*(0x[0-9A-Fa-f]+|[0-9]+)/);
        if (m) SDK_VERSION = m[1];
    } catch {}
}

// ── ZIP extractor (shared by all load paths) ───────────────────────────────
function extractZipBuffer(buf) {
    const AdmZip = require('adm-zip');
    if (fs.existsSync(RUNTIME_DIR)) fs.rmSync(RUNTIME_DIR, { recursive: true });
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    new AdmZip(buf).extractAllTo(RUNTIME_DIR, true);

    // Flatten single top-level folder (e.g. flow-sdk-v1.2.3/)
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
}

// ── Loader: local file path ────────────────────────────────────────────────
function loadFromPath(zipPath) {
    console.log(`[sdk] Loading from path: ${zipPath}`);
    const buf = fs.readFileSync(zipPath);
    extractZipBuffer(buf);
    console.log(`[sdk] Loaded. version=${SDK_VERSION} root=${SDK_ROOT}`);
}

// ── Loader: URL (https) ────────────────────────────────────────────────────
function downloadUrl(url, token) {
    return new Promise((resolve, reject) => {
        const https = require('https');
        const opts  = new URL(url);
        const reqOpts = {
            hostname: opts.hostname,
            path: opts.pathname + opts.search,
            headers: { 'User-Agent': 'flow-sdk-playground/2.0',
                       'Accept': 'application/octet-stream' },
            timeout: 60000,
        };
        if (token) reqOpts.headers['Authorization'] = `Bearer ${token}`;
        const req = https.get(reqOpts, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
                return resolve(downloadUrl(res.headers.location, ''));
            if (res.statusCode !== 200)
                return reject(new Error(`HTTP ${res.statusCode}`));
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

async function loadFromUrl(url, token) {
    console.log(`[sdk] Downloading: ${url}`);
    const buf = await downloadUrl(url, token);
    extractZipBuffer(buf);
    console.log(`[sdk] Loaded. version=${SDK_VERSION} root=${SDK_ROOT}`);
}

// ── Loader: GitHub latest release ─────────────────────────────────────────
async function loadFromGitHub() {
    const https = require('https');
    const OWNER = process.env.GITHUB_OWNER;
    const REPO  = process.env.GITHUB_REPO  || 'FLOW-releases';
    const TOKEN = process.env.GITHUB_TOKEN || '';

    function apiGet(apiPath) {
        return new Promise((resolve, reject) => {
            const reqOpts = {
                hostname: 'api.github.com',
                path: apiPath,
                headers: { 'User-Agent': 'flow-sdk-playground/2.0',
                           'Accept': 'application/vnd.github+json' },
                timeout: 10000,
            };
            if (TOKEN) reqOpts.headers['Authorization'] = `Bearer ${TOKEN}`;
            const req = https.get(reqOpts, res => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => resolve({ status: res.statusCode,
                                              body: Buffer.concat(chunks) }));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        });
    }

    console.log(`[sdk] Fetching GitHub release: ${OWNER}/${REPO}`);
    const { status, body } = await apiGet(
        `/repos/${OWNER}/${REPO}/releases/latest`);
    if (status !== 200) throw new Error(`GitHub API ${status}`);

    const release = JSON.parse(body.toString());
    const assets  = release.assets || [];
    let asset = assets.find(a => a.name.endsWith('.zip') &&
        (isWin ? a.name.includes('windows') : a.name.includes('linux')));
    if (!asset) asset = assets.find(a => a.name.endsWith('.zip'));
    if (!asset) throw new Error('No ZIP asset found in release');

    await loadFromUrl(asset.browser_download_url, TOKEN);
}

// ── Auto-detect ZIP in parent directory ───────────────────────────────────
function autoDetectZip() {
    if (process.env.SDK_ZIP_PATH) return process.env.SDK_ZIP_PATH;
    // Look for any *.zip in the parent folder (repo root)
    const parent = path.join(__dirname, '..');
    try {
        const zips = fs.readdirSync(parent)
            .filter(f => f.toLowerCase().endsWith('.zip'))
            .map(f => path.join(parent, f));
        if (zips.length > 0) {
            console.log(`[sdk] Auto-detected ZIP: ${zips[0]}`);
            return zips[0];
        }
    } catch {}
    return null;
}

// ── Startup ────────────────────────────────────────────────────────────────
async function startup() {
    try {
        const zipPath = autoDetectZip();
        if (zipPath) {
            // 1. Local ZIP found (env var or auto-detected in parent dir)
            loadFromPath(zipPath);
        } else if (process.env.GITHUB_OWNER) {
            // 2. Render: pull from GitHub releases
            await loadFromGitHub();
        } else if (fs.existsSync(RUNTIME_DIR)) {
            // 3. Previously extracted runtime still on disk
            SDK_ROOT = RUNTIME_DIR;
            detectVersion();
            detectBinaries();
            console.log(`[sdk] Reusing sdk_runtime/ (version=${SDK_VERSION})`);
        } else {
            // 4. Bundled fallback
            console.log('[sdk] Using bundled sdk/');
            detectVersion();
            detectBinaries();
        }
    } catch (e) {
        console.warn('[sdk] Startup load failed:', e.message, '— falling back to bundled sdk/');
        SDK_ROOT = BUNDLED_DIR;
        detectVersion();
        detectBinaries();
    }

    console.log(`\n  SDK root    : ${SDK_ROOT}`);
    console.log(`  SDK version : ${SDK_VERSION}`);
    console.log(`  flow binary : ${FLOW_BIN  || '(not found)'}`);
    console.log(`  validate    : ${VALID_BIN || '(not found)'}\n`);
}

// ── API: status ────────────────────────────────────────────────────────────
app.get('/api/status', (_req, res) => res.json({
    sdkVersion : SDK_VERSION,
    sdkRoot    : path.basename(SDK_ROOT),
    flowBin    : FLOW_BIN  ? path.basename(FLOW_BIN)  : null,
    validateBin: VALID_BIN ? path.basename(VALID_BIN) : null,
    canRun     : !!FLOW_BIN,
    canValidate: !!(VALID_BIN || FLOW_BIN),
}));

// ── API: load SDK (path or url) ────────────────────────────────────────────
// POST /api/load-sdk
//   { "type": "path", "value": "C:\\path\\to\\sdk.zip" }
//   { "type": "url",  "value": "https://example.com/sdk.zip" }
//   { "type": "github" }  — uses GITHUB_OWNER env
app.post('/api/load-sdk', async (req, res) => {
    const { type, value } = req.body;
    try {
        if (type === 'path') {
            if (!value) return res.status(400).json({ error: 'Missing value' });
            loadFromPath(value);
        } else if (type === 'url') {
            if (!value) return res.status(400).json({ error: 'Missing value' });
            await loadFromUrl(value, process.env.GITHUB_TOKEN || '');
        } else if (type === 'github') {
            if (!process.env.GITHUB_OWNER)
                return res.status(400).json({ error: 'GITHUB_OWNER not set' });
            await loadFromGitHub();
        } else {
            return res.status(400).json({ error: 'type must be path | url | github' });
        }
        res.json({
            ok: true, sdkVersion: SDK_VERSION,
            canRun: !!FLOW_BIN, canValidate: !!(VALID_BIN || FLOW_BIN),
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
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
            result.push({ type: 'dir', name: e.name, path: rel,
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
    try { res.json({ tree: buildTree(SDK_ROOT, ''), version: SDK_VERSION }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: file read ─────────────────────────────────────────────────────────
function resolveSafe(rel) {
    if (!rel) return null;
    const abs = path.resolve(SDK_ROOT, rel);
    if (!abs.startsWith(SDK_ROOT + path.sep) && abs !== SDK_ROOT) return null;
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

// ── API: run ───────────────────────────────────────────────────────────────
app.post('/api/run', (req, res) => {
    sseStart(res);
    if (!FLOW_BIN) {
        sseMsg(res, 'stderr', 'No FLOW binary found in sdk/bin/.\n');
        return sseDone(res, 1);
    }
    const { script, pluginPath } = req.body;
    if (!script) { sseMsg(res, 'stderr', 'No script content.\n'); return sseDone(res, 1); }

    const tmp = path.join(os.tmpdir(), `flow_${Date.now()}.flow`);
    fs.writeFileSync(tmp, script, 'utf8');

    const args = [];
    if (pluginPath) {
        args.push('--plugin', path.isAbsolute(pluginPath)
            ? pluginPath : path.join(SDK_ROOT, pluginPath));
    }
    args.push(tmp);

    sseMsg(res, 'info',
        `$ ${path.basename(FLOW_BIN)} ${args.map(a => path.basename(a)).join(' ')}\n`);

    const proc = spawn(FLOW_BIN, args, { cwd: SDK_ROOT });
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
    const tmp = path.join(os.tmpdir(), `flow_val_${Date.now()}.flow`);
    fs.writeFileSync(tmp, req.body.script || '', 'utf8');

    const bin  = VALID_BIN || FLOW_BIN;
    const args = VALID_BIN ? [tmp] : ['--validate', tmp];
    sseMsg(res, 'info',
        `$ ${path.basename(bin)} ${args.map(a => path.basename(a)).join(' ')}\n`);

    const proc = spawn(bin, args, { cwd: SDK_ROOT });
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
app.get('*', (_req, res) =>
    res.sendFile(path.join(__dirname, 'index.html')));

// ── Boot ───────────────────────────────────────────────────────────────────
startup().then(() =>
    app.listen(PORT, () =>
        console.log(`  FLOW SDK Playground → http://localhost:${PORT}\n`))
).catch(e => { console.error('Fatal startup error:', e); process.exit(1); });
