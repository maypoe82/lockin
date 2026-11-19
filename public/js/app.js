// LockIn front-end: theme, menu, notices, tabs, flashcards (spaced repetition),
// study timer, upload, quiz progress, generation status, plan checklist.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const csrf = document.body.dataset.csrf || '';

  // ---------- Light / dark mode (remembered in this browser) ----------
  const root = document.documentElement;
  const themeLabel = $('#theme-label');
  const syncTheme = () => { if (themeLabel) themeLabel.textContent = root.dataset.theme === 'dark' ? 'Light mode' : 'Dark mode'; };
  syncTheme();
  $('#theme-toggle')?.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('lockin-theme', root.dataset.theme); } catch (e) {}
    syncTheme();
  });

  // ---------- Mobile menu ----------
  const menuBtn = $('#menu-toggle');
  menuBtn?.addEventListener('click', () => {
    const open = $('#nav-links').classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  // ---------- Notices: dismiss button, success messages fade after 6s ----------
  $$('.flash').forEach((f) => {
    const close = () => { f.classList.add('fade'); setTimeout(() => f.remove(), 300); };
    $('.flash-close', f)?.addEventListener('click', close);
    if (f.classList.contains('flash-success')) setTimeout(close, 6000);
  });

  // ---------- Confirm before destructive actions ----------
  $$('form[data-confirm]').forEach((form) => form.addEventListener('submit', (e) => {
    if (!confirm(form.dataset.confirm)) e.preventDefault();
  }));

  // ---------- Tabs (Explanation / Brainrot / Key points / Flashcards) ----------
  const showTab = (name) => {
    $$('.tab').forEach((t) => { t.classList.toggle('active', t.dataset.tab === name); t.setAttribute('aria-selected', t.dataset.tab === name); });
    $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
  };
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.tab)));
  // Topic links always jump to the Explanation tab
  $$('[data-jump]').forEach((a) => a.addEventListener('click', () => showTab('learn')));

  // ---------- Flashcards with spaced repetition ----------
  const deck = $('.deck');
  if (deck) {
    let cards = $$('.flashcard', deck);
    let i = 0;
    const counter = $('[data-deck-count]', deck);
    const grade = $('[data-grade]', deck);
    const done = $('[data-deck-done]', deck);
    const show = () => {
      cards.forEach((c, k) => { c.classList.toggle('hidden', k !== i); c.classList.remove('flipped'); });
      counter.textContent = `${i + 1} / ${cards.length}`;
      grade.classList.add('hidden');
    };
    const flip = () => {
      const c = cards[i]; if (!c) return;
      c.classList.toggle('flipped');
      grade.classList.toggle('hidden', !c.classList.contains('flipped'));
    };
    const next = () => {
      if (i + 1 >= cards.length) {
        cards.forEach((c) => c.classList.add('hidden'));
        grade.classList.add('hidden');
        $('.deck-controls', deck).classList.add('hidden');
        done.classList.remove('hidden');
        return;
      }
      i++; show();
    };
    const record = (known) => {
      const c = cards[i];
      // Move on straight away; save the result in the background
      fetch(`/api/flashcards/${c.dataset.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ known }),
      }).catch(() => {});
      next();
    };
    cards.forEach((c) => c.addEventListener('click', flip));
    $$('[data-known]', grade).forEach((b) => b.addEventListener('click', () => record(b.dataset.known === 'true')));
    $('[data-deck="next"]', deck).onclick = next;
    $('[data-deck="prev"]', deck).onclick = () => { if (i > 0) { i--; show(); } };
    $('[data-deck="shuffle"]', deck).onclick = () => { cards.sort(() => Math.random() - 0.5); i = 0; show(); };
    document.addEventListener('keydown', (e) => {
      if (deck.closest('.hidden') || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); flip(); }
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft' && i > 0) { i--; show(); }
      if (!grade.classList.contains('hidden') && (e.key === '1' || e.key === '2')) record(e.key === '2');
    });
  }

  // ---------- Study timer: counts only while a study page is visible ----------
  if (document.body.dataset.study) {
    let seconds = 0;
    setInterval(() => { if (!document.hidden) seconds++; }, 1000);
    const send = () => {
      if (seconds < 5) return;
      const body = JSON.stringify({ seconds, _csrf: csrf });
      seconds = 0;
      if (navigator.sendBeacon) navigator.sendBeacon('/api/study-ping', new Blob([body], { type: 'application/json' }));
      else fetch('/api/study-ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    };
    setInterval(send, 60000);
    window.addEventListener('pagehide', send);
  }

  // ---------- Upload: drag and drop, file name, busy button ----------
  const drop = $('#dropzone');
  const fileInput = $('#file-input');
  if (drop && fileInput) {
    const showFile = () => {
      const f = fileInput.files[0];
      drop.classList.toggle('has-file', !!f);
      $('#drop-title').textContent = f ? f.name : 'Drag a PDF here, or click to choose a file';
      $('#drop-sub').textContent = f ? `${(f.size / 1024 / 1024).toFixed(1)} MB · click to change` : 'PDF, TXT or MD · maximum 20 MB';
    };
    fileInput.addEventListener('change', showFile);
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragover'); }));
    drop.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; showFile(); }
    });
  }
  $('#upload-form')?.addEventListener('submit', () => {
    const b = $('#upload-btn'); b.disabled = true; b.textContent = 'Uploading...';
  });

  // ---------- Quiz: answered count, highlight missing answers ----------
  const quiz = $('#quiz-form');
  if (quiz) {
    const total = Number(quiz.dataset.total);
    const update = () => {
      const answered = new Set($$('input[type=radio]:checked', quiz).map((r) => r.name)).size;
      $('#quiz-count').textContent = `${answered} of ${total} answered`;
      $('#quiz-bar').style.width = `${Math.round((answered / total) * 100)}%`;
    };
    quiz.addEventListener('change', (e) => { e.target.closest('.question')?.classList.remove('unanswered'); update(); });
    quiz.addEventListener('invalid', (e) => {
      const q = e.target.closest('.question');
      if (q && !q.classList.contains('unanswered')) { q.classList.add('unanswered'); }
    }, true);
    quiz.addEventListener('submit', () => { const b = $('button.btn-big', quiz); b.disabled = true; b.textContent = 'Submitting...'; });
    update();
  }

  // ---------- "Generating" page: check status every 4 seconds ----------
  const proc = $('.processing[data-status="processing"]');
  if (proc) {
    const poll = async () => {
      try {
        const r = await fetch(proc.dataset.statusUrl, { headers: { Accept: 'application/json' } });
        const { status } = await r.json();
        if (status !== 'processing') return location.reload();
      } catch (e) {}
      setTimeout(poll, 4000);
    };
    setTimeout(poll, 4000);
  }

  // ---------- Plan checklist remembers ticks in this browser ----------
  $$('[data-step]').forEach((box) => {
    const key = 'lockin-step-' + box.dataset.step;
    try { box.checked = localStorage.getItem(key) === '1'; } catch (e) {}
    box.addEventListener('change', () => { try { localStorage.setItem(key, box.checked ? '1' : '0'); } catch (e) {} });
  });
})();
