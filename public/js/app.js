// LockIn front-end: tabs, flashcards, study timer, plan checklist.
(function () {
  // Tabs (Learn / Brainrot / Notes / Flashcards)
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.tab));
    });
  });

  // Flashcard deck
  const deck = document.querySelector('.deck');
  if (deck) {
    let cards = [...deck.querySelectorAll('.flashcard')];
    let i = 0;
    const counter = deck.querySelector('[data-deck-count]');
    const show = () => {
      cards.forEach((c, k) => { c.classList.toggle('hidden', k !== i); c.classList.remove('flipped'); });
      counter.textContent = `${i + 1} / ${cards.length}`;
    };
    cards.forEach((c) => c.addEventListener('click', () => c.classList.toggle('flipped')));
    deck.querySelector('[data-deck="next"]').onclick = () => { i = (i + 1) % cards.length; show(); };
    deck.querySelector('[data-deck="prev"]').onclick = () => { i = (i - 1 + cards.length) % cards.length; show(); };
    deck.querySelector('[data-deck="shuffle"]').onclick = () => { cards.sort(() => Math.random() - 0.5); i = 0; show(); };
    document.addEventListener('keydown', (e) => {
      if (deck.closest('.hidden')) return;
      if (e.key === 'ArrowRight') { i = (i + 1) % cards.length; show(); }
      if (e.key === 'ArrowLeft') { i = (i - 1 + cards.length) % cards.length; show(); }
      if (e.key === ' ') { e.preventDefault(); cards[i].classList.toggle('flipped'); }
    });
  }

  // Study timer: only counts time while the tab is visible on a study page
  if (document.body.dataset.study) {
    let seconds = 0;
    setInterval(() => { if (!document.hidden) seconds++; }, 1000);
    const send = () => {
      if (seconds < 5) return;
      const body = JSON.stringify({ seconds });
      seconds = 0;
      navigator.sendBeacon
        ? navigator.sendBeacon('/api/study-ping', new Blob([body], { type: 'application/json' }))
        : fetch('/api/study-ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    };
    setInterval(send, 60000);
    window.addEventListener('pagehide', send);
  }

  // Upload: show "cooking" message
  const form = document.getElementById('upload-form');
  if (form) form.addEventListener('submit', () => {
    document.getElementById('upload-btn').disabled = true;
    document.getElementById('upload-wait').classList.remove('hidden');
  });

  // Plan checklist remembers ticks in this browser
  document.querySelectorAll('[data-step]').forEach((box) => {
    const key = 'lockin-step-' + box.dataset.step;
    try { box.checked = localStorage.getItem(key) === '1'; } catch (e) {}
    box.addEventListener('change', () => { try { localStorage.setItem(key, box.checked ? '1' : '0'); } catch (e) {} });
  });
})();
