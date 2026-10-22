/* MeritaAnalytics notes: Run / Edit / Reset for every code example, using Python in the browser. */
(function () {
  var dataEl = document.getElementById('ma-cells');
  if (!dataEl) return;
  var PAGE = JSON.parse(dataEl.textContent);   // {setup, datasets, fintech, cells:[{src, hidden, err, norun}]}
  var cells = PAGE.cells;
  var ran = [];
  var worker = null, ready = null, busy = false, nextId = 1, pending = {};
  var setupDone = false;

  // ---------- status pill ----------
  var pill = document.createElement('div');
  pill.className = 'py-pill'; pill.hidden = true; pill.setAttribute('role', 'status');
  pill.innerHTML = '<span class="py-dot"></span><span class="py-text">Python</span><button type="button" class="py-stop">Stop</button>';
  document.body.appendChild(pill);
  var pillText = pill.querySelector('.py-text'), stopBtn = pill.querySelector('.py-stop');
  function setStatus(text, state) {
    pill.hidden = false; pillText.textContent = text;
    pill.dataset.state = state || 'busy';
    stopBtn.hidden = state !== 'busy';
  }
  stopBtn.addEventListener('click', function () { restart('Stopped. Python restarted; run the examples again from the top.'); });

  function restart(msg) {
    if (worker) worker.terminate();
    worker = null; ready = null; busy = false; setupDone = false; ran = [];
    Object.keys(pending).forEach(function (k) { pending[k].reject(new Error('stopped')); });
    pending = {};
    document.querySelectorAll('.cell.running').forEach(function (c) { c.classList.remove('running'); });
    setStatus(msg, 'idle');
  }

  function send(msg) {
    return new Promise(function (resolve, reject) {
      msg.id = nextId++;
      pending[msg.id] = { resolve: resolve, reject: reject };
      worker.postMessage(msg);
    });
  }
  function getWorker() {
    if (ready) return ready;
    worker = new Worker('py-worker.js');
    worker.onmessage = function (e) {
      var m = e.data;
      if (m.type === 'status') { setStatus(m.text, 'busy'); return; }
      var p = pending[m.id]; if (!p) return; delete pending[m.id];
      if (m.type === 'fatal') p.reject(new Error(m.text)); else p.resolve(m.res);
    };
    worker.onerror = function (e) { setStatus('Python could not start. Check your connection and reload the page.', 'error'); };
    ready = send({ type: 'init', datasets: PAGE.datasets, fintech: PAGE.fintech });
    return ready;
  }

  // ---------- output rendering ----------
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function render(panel, res) {
    res.out.forEach(function (o) {
      var el;
      if (o[0] === 'text') { if (!o[1].trim()) return; el = document.createElement('pre'); el.className = 'out'; el.textContent = o[1].replace(/\n+$/, ''); }
      else if (o[0] === 'html') { el = document.createElement('div'); el.className = 'table-wrap df'; el.innerHTML = o[1].replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, ''); }
      else if (o[0] === 'png') { el = document.createElement('figure'); el.className = 'fig'; var img = document.createElement('img'); img.alt = 'Chart produced by your code'; img.src = 'data:image/png;base64,' + o[1]; el.appendChild(img); }
      if (el) panel.appendChild(el);
    });
    if (res.err) {
      var d = document.createElement('div'); d.className = 'err live';
      d.innerHTML = '<span class="err-tag">' + (res.err[0] === 'NotInBrowser' ? 'Not available here' : 'Error' + (res.err[2] ? ' on line ' + res.err[2] : '')) + '</span><code>' +
        esc(res.err[0] === 'NotInBrowser' ? res.err[1] : res.err[0] + ': ' + res.err[1]) + '</code>';
      panel.appendChild(d);
    }
  }
  function panelFor(cellEl) {
    var p = cellEl.querySelector('.live-out');
    if (!p) {
      p = document.createElement('div'); p.className = 'cell-out live-out';
      cellEl.appendChild(p);
    }
    var stat = cellEl.querySelector('.cell-out:not(.live-out)');
    if (stat) stat.hidden = true;
    p.innerHTML = '';
    return p;
  }

  // ---------- running ----------
  function codeOf(i) {
    var el = document.querySelector('.cell[data-ci="' + i + '"] pre.code code');
    return el ? el.innerText.replace(/ /g, ' ') : cells[i].src;
  }
  async function exec(code) { return send({ type: 'run', code: code }); }

  async function runCell(k) {
    if (busy) return;
    var cellEl = document.querySelector('.cell[data-ci="' + k + '"]');
    busy = true; cellEl.classList.add('running');
    try {
      await getWorker();
      if (!setupDone) { setStatus('Preparing this page…', 'busy'); await exec(PAGE.setup); setupDone = true; }
      // run earlier examples first so variables exist, like a notebook
      for (var j = 0; j < k; j++) {
        if (ran[j] || cells[j].norun) continue;
        setStatus('Running earlier example ' + (j + 1) + ' of ' + k + ' first…', 'busy');
        var r = await exec(codeOf(j));
        ran[j] = true;
        if (r.err && cells[j].hidden) continue;   // a hidden display step failed: keep the saved output
        var ej = document.querySelector('.cell[data-ci="' + j + '"]');
        if (ej) render(panelFor(ej), r);
        if (r.err && !cells[j].err) {
          var pf = panelFor(cellEl);
          pf.innerHTML = '<div class="err live"><span class="err-tag">Stopped</span><code>An earlier example on this page failed (' + esc(r.err[0]) + '). Reset or fix it, then run this one again.</code></div>';
          if (ej) ej.scrollIntoView({ block: 'center' });
          setStatus('An earlier example failed', 'error');
          return;
        }
      }
      setStatus('Running…', 'busy');
      var panel = panelFor(cellEl);
      var res = await exec(codeOf(k));
      ran[k] = true;
      render(panel, res);
      // hidden display steps right after this example show its saved charts
      for (var h = k + 1; h < cells.length && cells[h].hidden; h++) {
        if (cells[h].norun) continue;
        var rh = await exec(cells[h].src); ran[h] = true;
        if (rh.err) continue;
        var eh = document.querySelector('.cell[data-ci="' + h + '"]');
        render(eh ? panelFor(eh) : panel, rh);
      }
      if (!panel.childNodes.length) panel.innerHTML = '<pre class="out muted">Ran with no printed output.</pre>';
      setStatus('Python ready', 'idle');
    } catch (e) {
      if (String(e.message) !== 'stopped') setStatus('Python stopped: ' + e.message, 'error');
    } finally {
      busy = false; cellEl.classList.remove('running');
    }
  }

  // ---------- toolbar on each visible example ----------
  document.querySelectorAll('.cell[data-ci]').forEach(function (cellEl) {
    var k = +cellEl.dataset.ci, info = cells[k];
    var inBox = cellEl.querySelector('.cell-in');
    if (!inBox) return;
    var code = inBox.querySelector('pre.code code');
    var original = code.innerHTML;
    var bar = document.createElement('div'); bar.className = 'cell-bar';
    var copy = inBox.querySelector('.copy');
    if (info.norun) {
      var why = { torch: 'Needs PyTorch, which cannot run in a browser.', process: 'Starts a separate program, which a browser cannot do.', whole: 'Lists files made by every part of the handbook.' }[info.norun] || 'Cannot run in a browser.';
      bar.innerHTML = '<span class="bar-note">' + why + ' Run it in Jupyter or Google Colab.</span>';
    } else {
      bar.innerHTML = '<button type="button" class="run-btn">Run</button><button type="button" class="reset-btn" hidden>Reset</button><span class="bar-note">You can edit the code, then run it.</span>';
      code.setAttribute('contenteditable', 'plaintext-only');
      if (code.contentEditable !== 'plaintext-only') code.setAttribute('contenteditable', 'true');
      code.setAttribute('spellcheck', 'false');
      var reset = bar.querySelector('.reset-btn');
      bar.querySelector('.run-btn').addEventListener('click', function () { runCell(k); reset.hidden = false; });
      code.addEventListener('input', function () { reset.hidden = false; });
      code.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey || e.metaKey)) { e.preventDefault(); runCell(k); reset.hidden = false; }
        if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '    '); }
      });
      reset.addEventListener('click', function () {
        code.innerHTML = original;
        var live = cellEl.querySelector('.live-out'); if (live) live.remove();
        var stat = cellEl.querySelector('.cell-out:not(.live-out)'); if (stat) stat.hidden = false;
        reset.hidden = true;
      });
    }
    if (copy) bar.appendChild(copy);
    inBox.insertBefore(bar, inBox.firstChild);
  });
})();
