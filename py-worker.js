/* Runs Python (Pyodide) in a background thread so the page stays responsive. */
var PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
importScripts(PYODIDE_URL + 'pyodide.js');

var py = null;
var ROOT = '/home/pyodide/guide';
var PIP_NAMES = { sklearn: 'scikit-learn', yaml: 'pyyaml', PIL: 'pillow' };
var NO_BROWSER = { torch: 1, torchvision: 1, tensorflow: 1, keras: 1, shap: 1, umap: 1 };

function status(text) { postMessage({ type: 'status', text: text }); }

async function init(msg) {
  status('Downloading Python (first time only, about 10 MB)…');
  py = await loadPyodide({ indexURL: PYODIDE_URL });
  py.FS.mkdirTree(ROOT + '/datasets/public');
  py.FS.mkdirTree(ROOT + '/work');
  for (var i = 0; i < msg.datasets.length; i++) {
    var f = msg.datasets[i];
    status('Loading dataset ' + f + '…');
    var r = await fetch(f);
    if (r.ok) py.FS.writeFile(ROOT + '/datasets/public/' + f, new Uint8Array(await r.arrayBuffer()));
  }
  if (msg.fintech) {
    var t = await fetch('fintech_db.py');
    py.FS.writeFile(ROOT + '/fintech_db.py', await t.text());
    await py.loadPackage('sqlite3');
  }
  var h = await fetch('ma_runtime.py');
  py.FS.writeFile('/home/pyodide/ma_runtime.py', await h.text());
  await py.loadPackage(['micropip']);
  py.runPython([
    'import os, sys',
    "sys.path.insert(0, '/home/pyodide')",
    "sys.path.insert(0, '" + ROOT + "')",
    "os.environ['GUIDE_ROOT'] = '" + ROOT + "'",
    "os.chdir('" + ROOT + "')",
    'import ma_runtime'
  ].join('\n'));
}

async function runOnce(code) {
  try {
    await py.loadPackagesFromImports(code, { messageCallback: function (m) { if (/^Loading/.test(m)) status(m.replace(/, /g, ', ') + '…'); } });
  } catch (e) { /* a missing package is reported when the import runs */ }
  py.globals.set('_ma_code', code);
  return JSON.parse(await py.runPythonAsync('import ma_runtime\nawait ma_runtime.run(_ma_code)'));
}

async function run(code) {
  var res = await runOnce(code);
  // Packages that are not bundled with Pyodide (e.g. seaborn) install from PyPI on first use
  for (var tries = 0; tries < 3 && res.err && res.err[0] === 'ModuleNotFoundError'; tries++) {
    var m = /No module named '([^'.]+)/.exec(res.err[1]);
    if (!m) break;
    var name = m[1];
    if (NO_BROWSER[name]) { res.err = ['NotInBrowser', name + ' cannot run in the browser. Run this part in Jupyter or Google Colab.', null]; break; }
    status('Installing ' + name + '…');
    try {
      var mp = py.pyimport('micropip');
      await mp.install(PIP_NAMES[name] || name);
    } catch (e) { res.err = ['NotInBrowser', name + ' is not available in the browser. Run this part in Jupyter or Google Colab.', null]; break; }
    res = await runOnce(code);
  }
  return res;
}

var queue = Promise.resolve();
onmessage = function (e) {
  var msg = e.data;
  queue = queue.then(async function () {
    try {
      if (msg.type === 'init') { await init(msg); postMessage({ type: 'ready', id: msg.id }); }
      else if (msg.type === 'run') { var r = await run(msg.code); postMessage({ type: 'result', id: msg.id, res: r }); }
    } catch (err) {
      postMessage({ type: 'fatal', id: msg.id, text: String(err && err.message || err) });
    }
  });
};
