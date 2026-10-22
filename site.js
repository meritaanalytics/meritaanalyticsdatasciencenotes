(function () {
  // mobile drawer
  var btn = document.getElementById('menu');
  if (btn) {
    btn.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.querySelectorAll('.side a').forEach(function (a) {
      a.addEventListener('click', function () { document.body.classList.remove('nav-open'); btn.setAttribute('aria-expanded', 'false'); });
    });
  }

  // copy buttons on code
  document.querySelectorAll('.cell-in, .prose > pre.code').forEach(function (box) {
    var pre = box.tagName === 'PRE' ? box : box.querySelector('pre');
    if (!pre) return;
    var wrap = box;
    if (box.tagName === 'PRE') { wrap = document.createElement('div'); wrap.style.position = 'relative'; box.parentNode.insertBefore(wrap, box); wrap.appendChild(box); }
    var b = document.createElement('button');
    b.className = 'copy'; b.type = 'button'; b.textContent = 'Copy';
    b.addEventListener('click', function () {
      var text = pre.innerText;
      var done = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1400); };
      try {
        navigator.clipboard.writeText(text).then(done, function () { selectText(pre); b.textContent = 'Press Ctrl+C'; });
      } catch (e) { selectText(pre); b.textContent = 'Press Ctrl+C'; }
    });
    wrap.appendChild(b);
  });
  function selectText(el) { var r = document.createRange(); r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r); }

  // progress: parts marked done (this browser only)
  var KEY = 'ma-notes-done';
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  var done = load();
  function paint() {
    document.querySelectorAll('li[data-slug]').forEach(function (li) { li.classList.toggle('is-done', !!done[li.getAttribute('data-slug')]); });
    var m = document.getElementById('done');
    if (m) { var on = !!done[m.dataset.slug]; m.setAttribute('aria-pressed', on ? 'true' : 'false'); m.textContent = on ? 'Done ✓ (click to undo)' : 'Mark this part as done'; }
  }
  var mb = document.getElementById('done');
  if (mb) mb.addEventListener('click', function () { var s = mb.dataset.slug; if (done[s]) delete done[s]; else done[s] = 1; save(done); paint(); });
  paint();

  // search
  var q = document.getElementById('q'), res = document.getElementById('results'), idx = window.MA_INDEX || [];
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  if (q && res) {
    q.addEventListener('input', function () {
      var v = q.value.trim().toLowerCase();
      if (v.length < 2) { res.hidden = true; res.innerHTML = ''; return; }
      var words = v.split(/\s+/);
      var hits = idx.filter(function (e) { var t = e.t.toLowerCase(); return words.every(function (w) { return t.indexOf(w) > -1; }); }).slice(0, 30);
      res.innerHTML = hits.length ? hits.map(function (e) {
        return '<a href="' + e.p + '.html' + (e.a ? '#' + e.a : '') + '">' + esc(e.t) + '<small>' + esc(e.s) + '</small></a>';
      }).join('') : '<div class="none">No section matches “' + esc(q.value) + '”.</div>';
      res.hidden = false;
    });
    q.addEventListener('keydown', function (e) { if (e.key === 'Escape') { q.value = ''; res.hidden = true; } });
  }

  // keep the active part visible in the sidebar
  var on = document.querySelector('.nav a.on');
  if (on && on.scrollIntoView) { try { on.scrollIntoView({ block: 'center' }); window.scrollTo(0, 0); } catch (e) {} }
})();
