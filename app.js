// =============================================================
// Athelio — single-file state + views
// =============================================================

const STORAGE_KEY = 'athelio:v1';

const defaultState = {
  badminton: { matches: [], tournaments: [] },
  weight: [],
  measurements: [],
  runs: [],
  lifts: [],
  photos: [],
  goals: [],
  recovery: [],
  videos: [],
};

let state = load();
let currentView = 'dashboard';
let activeCharts = [];

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed();
    return migrate(JSON.parse(raw));
  } catch {
    return seed();
  }
}

// Normalise n'importe quelle sauvegarde (y compris l'ancienne structure
// « progression » qui regroupait poids/course/muscu/mensurations/photos)
// vers le nouveau modèle à modules distincts.
function migrate(parsed) {
  const s = { ...defaultState, ...parsed };
  const old = parsed.progression || {};
  s.weight = parsed.weight || old.weight || [];
  s.measurements = parsed.measurements || old.measurements || [];
  s.runs = parsed.runs || old.runs || [];
  s.lifts = parsed.lifts || old.lifts || [];
  s.photos = parsed.photos || old.photos || [];
  delete s.progression;
  s.badminton = { ...defaultState.badminton, ...(parsed.badminton || {}) };
  for (const k of ['weight', 'measurements', 'runs', 'lifts', 'photos', 'goals', 'recovery', 'videos']) {
    if (!Array.isArray(s[k])) s[k] = [];
  }
  if (!Array.isArray(s.badminton.matches)) s.badminton.matches = [];
  if (!Array.isArray(s.badminton.tournaments)) s.badminton.tournaments = [];
  return s;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    toast('Stockage plein — préfère un lien plutôt qu’un fichier vidéo lourd.');
    return false;
  }
}

function seed() {
  const today = new Date();
  const d = (offset) => new Date(today.getTime() - offset * 86400000).toISOString().slice(0, 10);
  const s = JSON.parse(JSON.stringify(defaultState));
  s.badminton.matches = [
    { id: id(), date: d(2), opponent: 'Lucas M.', type: 'simple', myScore: 21, oppScore: 18, result: 'win',
      goodPoints: 'Bon jeu au filet, revers solide tout le match.', badPoints: 'Quelques fautes directes en fond de court.', workPoints: 'Le dégagement défensif quand je suis en retard.' },
    { id: id(), date: d(5), opponent: 'Sarah / Tom', type: 'mixte', myScore: 19, oppScore: 21, result: 'loss',
      goodPoints: 'Bonne couverture du terrain en défense.', badPoints: 'Communication avec ma partenaire à revoir.', workPoints: 'Le placement après le service.' },
    { id: id(), date: d(9), opponent: 'Karim', type: 'simple', myScore: 21, oppScore: 15, result: 'win',
      goodPoints: 'Service précis et varié.', badPoints: '', workPoints: 'Garder le rythme sur les longs échanges.' },
    { id: id(), date: d(14), opponent: 'Paul / Antoine', type: 'double', myScore: 21, oppScore: 17, result: 'win',
      goodPoints: '', badPoints: '', workPoints: '' },
  ];
  s.badminton.tournaments = [
    { id: id(), name: 'Interclub J3', date: d(7), location: 'Lyon', result: 'Victoire 3-1' },
  ];
  s.weight = [
    { id: id(), date: d(28), value: 78.2 },
    { id: id(), date: d(21), value: 77.6 },
    { id: id(), date: d(14), value: 77.1 },
    { id: id(), date: d(7), value: 76.8 },
    { id: id(), date: d(0), value: 76.3 },
  ];
  s.runs = [
    { id: id(), date: d(20), distance: 5.0, duration: 28, notes: '' },
    { id: id(), date: d(12), distance: 8.2, duration: 47, notes: 'sortie longue' },
    { id: id(), date: d(5), distance: 5.5, duration: 27, notes: 'fractionné' },
  ];
  s.lifts = [
    { id: id(), date: d(18), exercise: 'Développé couché', weight: 75, reps: 6, sets: 4 },
    { id: id(), date: d(11), exercise: 'Squat', weight: 100, reps: 5, sets: 4 },
    { id: id(), date: d(4), exercise: 'Soulevé de terre', weight: 120, reps: 5, sets: 3 },
    { id: id(), date: d(1), exercise: 'Développé couché', weight: 80, reps: 5, sets: 4 },
  ];
  s.measurements = [
    { id: id(), date: d(28), waist: 84, arm: 36, thigh: 58, chest: 102 },
    { id: id(), date: d(0), waist: 82, arm: 37, thigh: 59, chest: 103 },
  ];
  s.goals = [
    { id: id(), title: 'Courir un 10 km en moins de 50 min', deadline: d(-60), done: false, progress: 60 },
    { id: id(), title: 'Atteindre 75 kg de poids de forme', deadline: d(-30), done: false, progress: 70 },
  ];
  s.recovery = [
    { id: id(), date: d(1), fatigue: 4, pain: 3, notes: 'Cuisse tendue' },
    { id: id(), date: d(0), fatigue: 3, pain: 2, notes: '' },
  ];
  s.videos = [];
  return s;
}

function id() { return Math.random().toString(36).slice(2, 10); }

// =============================================================
// Helpers
// =============================================================

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function shortDate(s) {
  const d = new Date(s);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function today() { return new Date().toISOString().slice(0, 10); }

function toast(msg) {
  const t = el('div', { class: 'toast' }, msg);
  $('#toast-root').appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

function openModal(title, contentFactory) {
  const root = $('#modal-root');
  const close = () => root.innerHTML = '';
  const backdrop = el('div', { class: 'modal-backdrop', onClick: (e) => { if (e.target === backdrop) close(); } },
    el('div', { class: 'modal' },
      el('h3', {}, title),
      contentFactory(close),
    )
  );
  root.innerHTML = '';
  root.appendChild(backdrop);
}

function confirmAction(msg, onYes) {
  openModal('Confirmation', (close) => el('div', {},
    el('p', { style: 'margin: 0 0 16px; color: var(--text-dim); font-size: 14px;' }, msg),
    el('div', { class: 'form-actions' },
      el('button', { class: 'btn secondary', onClick: close }, 'Annuler'),
      el('button', { class: 'btn', onClick: () => { onYes(); close(); } }, 'Confirmer'),
    ),
  ));
}

function destroyCharts() {
  activeCharts.forEach(c => { try { c.destroy(); } catch {} });
  activeCharts = [];
}

function chart(ctx, config) {
  const c = new Chart(ctx, config);
  activeCharts.push(c);
  return c;
}

const chartTheme = {
  text: '#8a9aae',
  grid: 'rgba(255,255,255,0.05)',
  accent: '#ff5b2e',
  accent2: '#ffb547',
  info: '#3aa8ff',
  success: '#2ecc71',
};

function baseScales(yLabel = '') {
  return {
    x: {
      ticks: { color: chartTheme.text, font: { size: 11 } },
      grid: { color: chartTheme.grid },
    },
    y: {
      ticks: { color: chartTheme.text, font: { size: 11 } },
      grid: { color: chartTheme.grid },
      title: yLabel ? { display: true, text: yLabel, color: chartTheme.text } : undefined,
    },
  };
}

function viewHeader(title, subtitle, ...actions) {
  return el('div', { class: 'view-header' },
    el('div', {}, el('h2', {}, title), el('p', {}, subtitle)),
    actions.length ? el('div', { style: 'display: flex; gap: 8px; flex-wrap: wrap;' }, ...actions) : null,
  );
}

// =============================================================
// Router
// =============================================================

function navigate(view) {
  currentView = view;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  destroyCharts();
  const main = $('#main');
  main.innerHTML = '';
  const renderer = views[view] || views.dashboard;
  main.appendChild(renderer());
}

// =============================================================
// Views
// =============================================================

const views = {};

// ---------- Dashboard ----------

views.dashboard = () => {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'view-header' },
    el('div', {},
      el('h2', {}, 'Tableau de bord'),
      el('p', {}, 'Une vue d\'ensemble de ta progression.'),
    ),
  ));

  const matches = state.badminton.matches;
  const wins = matches.filter(m => m.result === 'win').length;
  const winRate = matches.length ? Math.round((wins / matches.length) * 100) : 0;
  const lastWeight = state.weight.at(-1);
  const firstWeight = state.weight[0];
  const weightDelta = lastWeight && firstWeight ? (lastWeight.value - firstWeight.value).toFixed(1) : null;
  const totalDistance = state.runs.reduce((s, r) => s + (r.distance || 0), 0);
  const recovery = state.recovery.at(-1);

  const kpis = el('div', { class: 'grid cols-4' });
  kpis.appendChild(kpiCard('🏸 Matchs joués', matches.length, `${wins} V — ${matches.length - wins} D`));
  kpis.appendChild(kpiCard('🏆 Taux de victoire', `${winRate}%`, '', winRate >= 50 ? 'success' : 'danger'));
  kpis.appendChild(kpiCard('⚖️ Poids actuel', lastWeight ? `${lastWeight.value} kg` : '—',
    weightDelta !== null ? `${weightDelta > 0 ? '+' : ''}${weightDelta} kg` : '', weightDelta < 0 ? 'success' : 'accent'));
  kpis.appendChild(kpiCard('🏃 Distance totale', `${totalDistance.toFixed(1)} km`, `${state.runs.length} sorties`));
  wrap.appendChild(kpis);

  wrap.appendChild(el('div', { style: 'height: 16px;' }));

  const charts = el('div', { class: 'grid cols-2' });

  const weightCard = el('div', { class: 'card' }, el('h3', {}, 'Évolution du poids'),
    el('div', { class: 'chart-wrap' }, el('canvas', { id: 'dash-weight' })));
  const matchCard = el('div', { class: 'card' }, el('h3', {}, 'Résultats badminton'),
    el('div', { class: 'chart-wrap' }, el('canvas', { id: 'dash-matches' })));
  charts.appendChild(weightCard);
  charts.appendChild(matchCard);
  wrap.appendChild(charts);

  wrap.appendChild(el('div', { style: 'height: 16px;' }));

  // Goals + Recovery side by side
  const lower = el('div', { class: 'grid cols-2' });
  const goalsCard = el('div', { class: 'card' }, el('h3', {}, 'Objectifs en cours'));
  const activeGoals = state.goals.filter(g => !g.done).slice(0, 4);
  if (!activeGoals.length) {
    goalsCard.appendChild(emptyState('Aucun objectif', 'Ajoute ton premier objectif dans la section Objectifs.'));
  } else {
    activeGoals.forEach(g => goalsCard.appendChild(goalRow(g, false)));
  }
  lower.appendChild(goalsCard);

  const recCard = el('div', { class: 'card' }, el('h3', {}, 'Récupération récente'));
  if (!recovery) {
    recCard.appendChild(emptyState('Aucune entrée', 'Note ta fatigue et tes douleurs.'));
  } else {
    const rows = el('div', {});
    rows.appendChild(infoRow('Fatigue', `${recovery.fatigue}/5`));
    rows.appendChild(infoRow('Douleurs', `${recovery.pain}/5`));
    rows.appendChild(infoRow('Dernière entrée', fmtDate(recovery.date)));
    recCard.appendChild(rows);
  }
  lower.appendChild(recCard);
  wrap.appendChild(lower);

  // Charts deferred until in DOM
  setTimeout(() => {
    if (state.weight.length) {
      chart($('#dash-weight').getContext('2d'), {
        type: 'line',
        data: {
          labels: state.weight.map(w => shortDate(w.date)),
          datasets: [{
            label: 'Poids (kg)',
            data: state.weight.map(w => w.value),
            borderColor: chartTheme.accent,
            backgroundColor: 'rgba(255, 91, 46, 0.15)',
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointBackgroundColor: chartTheme.accent,
          }],
        },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: baseScales() }
      });
    }
    const wins = state.badminton.matches.filter(m => m.result === 'win').length;
    const losses = state.badminton.matches.filter(m => m.result === 'loss').length;
    chart($('#dash-matches').getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Victoires', 'Défaites'],
        datasets: [{
          data: [wins, losses],
          backgroundColor: [chartTheme.success, chartTheme.accent],
          borderColor: 'transparent',
        }],
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: chartTheme.text } } },
        cutout: '65%' }
    });
  }, 0);

  return wrap;
};

function kpiCard(label, value, sub = '', kind = '') {
  return el('div', { class: 'card kpi' },
    el('div', { class: 'label' }, label),
    el('div', { class: `value ${kind}` }, String(value)),
    sub ? el('div', { class: 'sub' }, sub) : null,
  );
}

function infoRow(k, v) {
  return el('div', { class: 'list-item' },
    el('div', { class: 'title', style: 'font-weight: 500; color: var(--text-dim); font-size: 13px;' }, k),
    el('div', { style: 'font-weight: 600; font-size: 14px;' }, v),
  );
}

function emptyState(title, sub) {
  return el('div', { class: 'empty' }, el('strong', {}, title), sub);
}

// ---------- Badminton ----------

let badmintonTab = 'matches';

views.badminton = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Badminton', 'Suivi des matchs, tournois, et statistiques.',
    el('button', { class: 'btn', onClick: () => openMatchForm() }, '+ Nouveau match'),
    el('button', { class: 'btn secondary', onClick: () => openTournamentForm() }, '+ Tournoi'),
  ));

  // KPI per game type
  const matches = state.badminton.matches;
  const byType = (t) => matches.filter(m => m.type === t);
  const wr = (arr) => arr.length ? Math.round(arr.filter(m => m.result === 'win').length / arr.length * 100) : 0;

  const kpis = el('div', { class: 'grid cols-3' });
  ['simple', 'double', 'mixte'].forEach(type => {
    const arr = byType(type);
    kpis.appendChild(el('div', { class: 'card kpi' },
      el('div', { class: 'label' }, type.charAt(0).toUpperCase() + type.slice(1)),
      el('div', { class: 'value' }, String(arr.length)),
      el('div', { class: 'sub' }, `Taux de victoire : ${wr(arr)}%`),
    ));
  });
  wrap.appendChild(kpis);

  wrap.appendChild(el('div', { style: 'height: 16px;' }));

  // Tabs
  const tabs = el('div', { class: 'tabs' },
    tabBtn('matches', 'Matchs', () => { badmintonTab = 'matches'; navigate('badminton'); }),
    tabBtn('tournaments', 'Tournois & interclubs', () => { badmintonTab = 'tournaments'; navigate('badminton'); }),
    tabBtn('stats', 'Statistiques', () => { badmintonTab = 'stats'; navigate('badminton'); }),
  );
  wrap.appendChild(tabs);

  if (badmintonTab === 'matches') {
    const card = el('div', { class: 'card' });
    if (!matches.length) {
      card.appendChild(emptyState('Aucun match', 'Ajoute ton premier match pour commencer.'));
    } else {
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {},
        ...['Date', 'Adversaire', 'Type', 'Score', 'Résultat', ''].map(h => el('th', {}, h)))));
      const tbody = el('tbody');
      [...matches].sort((a, b) => b.date.localeCompare(a.date)).forEach(m => {
        const hasNotes = (m.goodPoints || m.badPoints || m.workPoints || m.notes || '').trim().length > 0;
        const detailRow = el('tr', { class: 'match-notes-row', hidden: '' },
          el('td', { colspan: '6' },
            el('div', { class: 'match-notes' },
              noteBlock('✅ Bien fait', m.goodPoints),
              noteBlock('❌ Mal fait', m.badPoints),
              noteBlock('🎯 À travailler', m.workPoints),
              (m.notes && m.notes.trim()) ? noteBlock('📝 Notes', m.notes) : null,
            ),
          ),
        );
        const toggle = hasNotes ? el('button', { class: 'icon-btn', title: 'Voir les notes', onClick: (e) => {
          const open = detailRow.hasAttribute('hidden');
          if (open) detailRow.removeAttribute('hidden'); else detailRow.setAttribute('hidden', '');
          e.currentTarget.textContent = open ? '▴' : '▾';
        } }, '▾') : null;
        tbody.appendChild(el('tr', {},
          el('td', {}, fmtDate(m.date)),
          el('td', {}, m.opponent || '—'),
          el('td', { html: `<span class="badge neutral">${m.type}</span>` }),
          el('td', {}, `${m.myScore} – ${m.oppScore}`),
          el('td', { html: `<span class="badge ${m.result === 'win' ? 'win' : 'loss'}">${m.result === 'win' ? 'Victoire' : 'Défaite'}</span>` }),
          el('td', { style: 'text-align: right; white-space: nowrap;' },
            toggle,
            el('button', { class: 'icon-btn', onClick: () => openMatchForm(m) }, '✎'),
            el('button', { class: 'icon-btn danger', onClick: () => confirmAction('Supprimer ce match ?', () => {
              state.badminton.matches = state.badminton.matches.filter(x => x.id !== m.id);
              save(); navigate('badminton'); toast('Match supprimé');
            }) }, '✕'),
          ),
        ));
        tbody.appendChild(detailRow);
      });
      table.appendChild(tbody);
      card.appendChild(table);
    }
    wrap.appendChild(card);
  } else if (badmintonTab === 'tournaments') {
    const card = el('div', { class: 'card' });
    const list = state.badminton.tournaments;
    if (!list.length) {
      card.appendChild(emptyState('Aucun tournoi', 'Ajoute un tournoi ou un interclub.'));
    } else {
      list.forEach(t => card.appendChild(el('div', { class: 'list-item' },
        el('div', {},
          el('div', { class: 'title' }, t.name),
          el('div', { class: 'meta' }, `${fmtDate(t.date)} · ${t.location || '—'} · ${t.result || '—'}`),
        ),
        el('div', { class: 'actions' },
          el('button', { class: 'icon-btn', onClick: () => openTournamentForm(t) }, '✎'),
          el('button', { class: 'icon-btn danger', onClick: () => confirmAction('Supprimer ce tournoi ?', () => {
            state.badminton.tournaments = state.badminton.tournaments.filter(x => x.id !== t.id);
            save(); navigate('badminton'); toast('Tournoi supprimé');
          }) }, '✕'),
        ),
      )));
    }
    wrap.appendChild(card);
  } else {
    // stats
    const grid = el('div', { class: 'grid cols-2' });
    grid.appendChild(el('div', { class: 'card' }, el('h3', {}, 'Répartition par type'),
      el('div', { class: 'chart-wrap' }, el('canvas', { id: 'bad-types' }))));
    grid.appendChild(el('div', { class: 'card' }, el('h3', {}, 'Victoires / Défaites par type'),
      el('div', { class: 'chart-wrap' }, el('canvas', { id: 'bad-results' }))));
    wrap.appendChild(grid);
    setTimeout(() => {
      const types = ['simple', 'double', 'mixte'];
      chart($('#bad-types').getContext('2d'), {
        type: 'bar',
        data: { labels: types, datasets: [{ label: 'Matchs', data: types.map(t => byType(t).length),
          backgroundColor: chartTheme.accent }] },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } }, scales: baseScales() }
      });
      chart($('#bad-results').getContext('2d'), {
        type: 'bar',
        data: {
          labels: types,
          datasets: [
            { label: 'Victoires', data: types.map(t => byType(t).filter(m => m.result === 'win').length), backgroundColor: chartTheme.success },
            { label: 'Défaites', data: types.map(t => byType(t).filter(m => m.result === 'loss').length), backgroundColor: chartTheme.accent },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: chartTheme.text } } },
          scales: { ...baseScales(), x: { ...baseScales().x, stacked: true }, y: { ...baseScales().y, stacked: true } } }
      });
    }, 0);
  }

  return wrap;
};

function noteBlock(label, text) {
  return el('div', { class: 'note-block' },
    el('div', { class: 'note-label' }, label),
    el('div', { class: 'note-text' }, (text && text.trim()) ? text : '—'),
  );
}

function tabBtn(key, label, onClick) {
  return el('button', { class: `tab ${badmintonTab === key ? 'active' : ''}`, onClick }, label);
}

function openMatchForm(existing) {
  const m = existing || { date: today(), opponent: '', type: 'simple', myScore: 21, oppScore: 0, goodPoints: '', badPoints: '', workPoints: '' };
  openModal(existing ? 'Modifier le match' : 'Nouveau match', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      const entry = {
        id: existing?.id || id(),
        date: data.date,
        opponent: data.opponent.trim(),
        type: data.type,
        myScore: +data.myScore,
        oppScore: +data.oppScore,
        result: +data.myScore > +data.oppScore ? 'win' : 'loss',
        goodPoints: data.goodPoints.trim(),
        badPoints: data.badPoints.trim(),
        workPoints: data.workPoints.trim(),
        notes: existing?.notes || '',
      };
      if (existing) {
        state.badminton.matches = state.badminton.matches.map(x => x.id === entry.id ? entry : x);
      } else {
        state.badminton.matches.push(entry);
      }
      save(); close(); navigate('badminton'); toast(existing ? 'Match mis à jour' : 'Match ajouté');
    } });
    form.innerHTML = `
      <div class="form-row">
        <div><label>Date</label><input type="date" name="date" value="${m.date}" required></div>
        <div><label>Type</label><select name="type">
          <option value="simple" ${m.type === 'simple' ? 'selected' : ''}>Simple</option>
          <option value="double" ${m.type === 'double' ? 'selected' : ''}>Double</option>
          <option value="mixte" ${m.type === 'mixte' ? 'selected' : ''}>Mixte</option>
        </select></div>
      </div>
      <div><label>Adversaire</label><input type="text" name="opponent" value="${m.opponent || ''}" placeholder="Nom ou équipe"></div>
      <div class="form-row">
        <div><label>Mon score</label><input type="number" name="myScore" value="${m.myScore}" min="0" required></div>
        <div><label>Score adverse</label><input type="number" name="oppScore" value="${m.oppScore}" min="0" required></div>
      </div>
      <div><label>✅ Qu’est-ce que j’ai bien fait&nbsp;?</label><textarea name="goodPoints" placeholder="Points forts du match…">${m.goodPoints || ''}</textarea></div>
      <div><label>❌ Qu’est-ce que j’ai mal fait&nbsp;?</label><textarea name="badPoints" placeholder="Erreurs, points faibles…">${m.badPoints || ''}</textarea></div>
      <div><label>🎯 Sur quels points dois-je bosser&nbsp;?</label><textarea name="workPoints" placeholder="Axes de travail pour la prochaine fois…">${m.workPoints || ''}</textarea></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

function openTournamentForm(existing) {
  const t = existing || { date: today(), name: '', location: '', result: '' };
  openModal(existing ? 'Modifier le tournoi' : 'Nouveau tournoi', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      const entry = { id: existing?.id || id(), ...data };
      if (existing) state.badminton.tournaments = state.badminton.tournaments.map(x => x.id === entry.id ? entry : x);
      else state.badminton.tournaments.push(entry);
      save(); close(); navigate('badminton'); toast(existing ? 'Tournoi mis à jour' : 'Tournoi ajouté');
    } });
    form.innerHTML = `
      <div><label>Nom</label><input type="text" name="name" value="${t.name || ''}" required></div>
      <div class="form-row">
        <div><label>Date</label><input type="date" name="date" value="${t.date}" required></div>
        <div><label>Lieu</label><input type="text" name="location" value="${t.location || ''}"></div>
      </div>
      <div><label>Résultat</label><input type="text" name="result" value="${t.result || ''}" placeholder="ex : Demi-finale, Victoire 3-1"></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// ---------- Poids ----------

views.weight = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Poids', 'Suis l’évolution de ton poids de forme.',
    el('button', { class: 'btn', onClick: () => simpleEntryForm('weight', { label: 'Poids (kg)', field: 'value', type: 'number', step: '0.1' }) }, '+ Nouvelle pesée')));

  const card = el('div', { class: 'card' }, el('h3', {}, 'Évolution du poids'),
    el('div', { class: 'chart-wrap tall' }, el('canvas', { id: 'w-chart' })));
  wrap.appendChild(card);

  const listCard = el('div', { class: 'card', style: 'margin-top: 16px;' }, el('h3', {}, 'Historique'));
  const arr = [...state.weight].sort((a, b) => b.date.localeCompare(a.date));
  if (!arr.length) listCard.appendChild(emptyState('Aucune pesée', 'Ajoute ta première pesée.'));
  arr.forEach(w => listCard.appendChild(el('div', { class: 'list-item' },
    el('div', {}, el('div', { class: 'title' }, `${w.value} kg`), el('div', { class: 'meta' }, fmtDate(w.date))),
    el('button', { class: 'icon-btn danger', onClick: () => {
      state.weight = state.weight.filter(x => x.id !== w.id);
      save(); navigate('weight'); toast('Entrée supprimée');
    } }, '✕'),
  )));
  wrap.appendChild(listCard);

  setTimeout(() => {
    if (!state.weight.length) return;
    const sorted = [...state.weight].sort((a, b) => a.date.localeCompare(b.date));
    chart($('#w-chart').getContext('2d'), {
      type: 'line',
      data: {
        labels: sorted.map(w => shortDate(w.date)),
        datasets: [{ label: 'Poids', data: sorted.map(w => w.value),
          borderColor: chartTheme.accent, backgroundColor: 'rgba(255,91,46,0.15)', fill: true, tension: 0.35, pointRadius: 4 }],
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } }, scales: baseScales('kg') }
    });
  }, 0);
  return wrap;
};

// ---------- Course ----------

views.runs = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Course à pied', 'Distances, durées et allures de tes sorties.',
    el('button', { class: 'btn', onClick: () => openRunForm() }, '+ Nouvelle sortie')));

  const card = el('div', { class: 'card' }, el('h3', {}, 'Distances parcourues'),
    el('div', { class: 'chart-wrap tall' }, el('canvas', { id: 'r-chart' })));
  wrap.appendChild(card);

  const list = el('div', { class: 'card', style: 'margin-top: 16px;' }, el('h3', {}, 'Sorties'));
  const arr = [...state.runs].sort((a, b) => b.date.localeCompare(a.date));
  if (!arr.length) list.appendChild(emptyState('Aucune sortie', 'Ajoute ta première sortie.'));
  arr.forEach(r => {
    const pace = r.distance ? (r.duration / r.distance).toFixed(2) : '—';
    list.appendChild(el('div', { class: 'list-item' },
      el('div', {},
        el('div', { class: 'title' }, `${r.distance} km en ${r.duration} min`),
        el('div', { class: 'meta' }, `${fmtDate(r.date)} · allure ${pace} min/km${r.notes ? ' · ' + r.notes : ''}`),
      ),
      el('button', { class: 'icon-btn danger', onClick: () => {
        state.runs = state.runs.filter(x => x.id !== r.id);
        save(); navigate('runs');
      } }, '✕'),
    ));
  });
  wrap.appendChild(list);

  setTimeout(() => {
    if (!state.runs.length) return;
    const sorted = [...state.runs].sort((a, b) => a.date.localeCompare(b.date));
    chart($('#r-chart').getContext('2d'), {
      type: 'bar',
      data: {
        labels: sorted.map(r => shortDate(r.date)),
        datasets: [{ label: 'Distance (km)', data: sorted.map(r => r.distance), backgroundColor: chartTheme.info }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: baseScales('km') }
    });
  }, 0);
  return wrap;
};

function openRunForm() {
  openModal('Nouvelle sortie', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      state.runs.push({ id: id(), date: d.date, distance: +d.distance, duration: +d.duration, notes: d.notes.trim() });
      save(); close(); navigate('runs'); toast('Sortie ajoutée');
    } });
    form.innerHTML = `
      <div class="form-row">
        <div><label>Date</label><input type="date" name="date" value="${today()}" required></div>
        <div><label>Distance (km)</label><input type="number" step="0.1" name="distance" required></div>
      </div>
      <div><label>Durée (min)</label><input type="number" step="0.1" name="duration" required></div>
      <div><label>Notes</label><textarea name="notes" placeholder="ressenti, parcours…"></textarea></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// ---------- Musculation ----------

views.lifts = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Musculation', 'Historique des séances et progression des charges.',
    el('button', { class: 'btn', onClick: () => openLiftForm() }, '+ Nouvelle séance')));

  const exercises = [...new Set(state.lifts.map(l => l.exercise))];
  const card = el('div', { class: 'card' }, el('h3', {}, 'Charges max par exercice'),
    el('div', { class: 'chart-wrap tall' }, el('canvas', { id: 'l-chart' })));
  wrap.appendChild(card);

  const list = el('div', { class: 'card', style: 'margin-top: 16px;' }, el('h3', {}, 'Historique'));
  const arr = [...state.lifts].sort((a, b) => b.date.localeCompare(a.date));
  if (!arr.length) list.appendChild(emptyState('Aucune séance', 'Ajoute ta première séance.'));
  arr.forEach(l => list.appendChild(el('div', { class: 'list-item' },
    el('div', {},
      el('div', { class: 'title' }, `${l.exercise} — ${l.weight} kg`),
      el('div', { class: 'meta' }, `${fmtDate(l.date)} · ${l.sets} × ${l.reps} reps`),
    ),
    el('button', { class: 'icon-btn danger', onClick: () => {
      state.lifts = state.lifts.filter(x => x.id !== l.id);
      save(); navigate('lifts');
    } }, '✕'),
  )));
  wrap.appendChild(list);

  setTimeout(() => {
    if (!exercises.length) return;
    const palette = [chartTheme.accent, chartTheme.info, chartTheme.success, chartTheme.accent2, '#ad6cff'];
    const allDates = [...new Set(state.lifts.map(l => l.date))].sort();
    const labels = allDates.map(d => shortDate(d));
    const datasets = exercises.map((ex, i) => {
      const byDate = Object.fromEntries(
        state.lifts.filter(l => l.exercise === ex).map(l => [l.date, l.weight])
      );
      return {
        label: ex,
        data: allDates.map(d => byDate[d] ?? null),
        borderColor: palette[i % palette.length],
        backgroundColor: palette[i % palette.length],
        tension: 0.3,
        pointRadius: 4,
        fill: false,
        spanGaps: true,
      };
    });
    chart($('#l-chart').getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: chartTheme.text } } },
        scales: baseScales('kg'),
      },
    });
  }, 0);
  return wrap;
};

function openLiftForm() {
  openModal('Nouvelle séance', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      state.lifts.push({ id: id(), date: d.date, exercise: d.exercise.trim(), weight: +d.weight, reps: +d.reps, sets: +d.sets });
      save(); close(); navigate('lifts'); toast('Séance ajoutée');
    } });
    form.innerHTML = `
      <div class="form-row">
        <div><label>Date</label><input type="date" name="date" value="${today()}" required></div>
        <div><label>Exercice</label><input type="text" name="exercise" placeholder="Squat, Bench…" required></div>
      </div>
      <div class="form-row">
        <div><label>Charge (kg)</label><input type="number" step="0.5" name="weight" required></div>
        <div><label>Reps</label><input type="number" name="reps" value="5" required></div>
      </div>
      <div><label>Séries</label><input type="number" name="sets" value="4" required></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// ---------- Mensurations ----------

const BODY_SVG = `
<svg viewBox="0 0 320 500" role="img" aria-label="Schéma des points de mensuration">
  <defs>
    <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#26303f"/>
      <stop offset="1" stop-color="#1b2330"/>
    </linearGradient>
  </defs>
  <g fill="url(#bodyGrad)">
    <circle cx="160" cy="46" r="26"/>
    <rect x="150" y="68" width="20" height="18" rx="8"/>
    <rect x="112" y="92" width="96" height="74" rx="30"/>
    <rect x="126" y="150" width="68" height="66" rx="24"/>
    <rect x="116" y="196" width="88" height="54" rx="26"/>
    <rect x="80" y="100" width="26" height="122" rx="13"/>
    <rect x="214" y="100" width="26" height="122" rx="13"/>
    <rect x="124" y="238" width="30" height="214" rx="15"/>
    <rect x="166" y="238" width="30" height="214" rx="15"/>
  </g>
  <g stroke="#ff5b2e" stroke-width="2" fill="none" stroke-dasharray="5 4" stroke-linecap="round">
    <line x1="104" y1="120" x2="216" y2="120"/>
    <line x1="112" y1="182" x2="208" y2="182"/>
    <ellipse cx="93" cy="150" rx="20" ry="11"/>
    <ellipse cx="139" cy="300" rx="22" ry="12"/>
  </g>
  <g stroke="#ff5b2e" stroke-width="1.5">
    <line x1="216" y1="120" x2="244" y2="120"/>
    <line x1="208" y1="182" x2="244" y2="182"/>
    <line x1="73" y1="150" x2="52" y2="150"/>
    <line x1="117" y1="300" x2="60" y2="300"/>
  </g>
  <g fill="#ff5b2e">
    <circle cx="244" cy="120" r="2.5"/>
    <circle cx="244" cy="182" r="2.5"/>
    <circle cx="52" cy="150" r="2.5"/>
    <circle cx="60" cy="300" r="2.5"/>
  </g>
  <g fill="#e6edf6" font-family="Inter, sans-serif" font-size="13" font-weight="600">
    <text x="250" y="124">Poitrine</text>
    <text x="250" y="186">Taille</text>
    <text x="46" y="154" text-anchor="end">Bras</text>
    <text x="54" y="304" text-anchor="end">Cuisse</text>
  </g>
</svg>`;

views.measurements = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Mensurations', 'Mesure-toi régulièrement aux bons endroits pour suivre ta transformation.',
    el('button', { class: 'btn', onClick: () => openMeasurementForm() }, '+ Nouvelle mesure')));

  const grid = el('div', { class: 'grid cols-2 measure-grid' });

  const diagram = el('div', { class: 'card body-diagram-card' },
    el('h3', {}, 'Où prendre les mesures'),
    el('div', { class: 'body-diagram', html: BODY_SVG }),
    el('p', { class: 'diagram-hint' },
      'Poitrine : au niveau le plus fort. Bras : biceps contracté. Taille : au plus étroit, au-dessus du nombril. Cuisse : au plus large. Mesure toujours au même endroit, le matin, sans serrer le mètre.'),
  );

  const chartCard = el('div', { class: 'card' }, el('h3', {}, 'Évolution des mensurations (cm)'),
    el('div', { class: 'chart-wrap tall' }, el('canvas', { id: 'm-chart' })));

  grid.appendChild(diagram);
  grid.appendChild(chartCard);
  wrap.appendChild(grid);

  const list = el('div', { class: 'card', style: 'margin-top: 16px;' }, el('h3', {}, 'Historique'));
  const arr = [...state.measurements].sort((a, b) => b.date.localeCompare(a.date));
  if (!arr.length) list.appendChild(emptyState('Aucune mesure', 'Ajoute ta première série de mesures.'));
  arr.forEach(m => list.appendChild(el('div', { class: 'list-item' },
    el('div', {},
      el('div', { class: 'title' }, fmtDate(m.date)),
      el('div', { class: 'meta' }, `Poitrine ${m.chest || '—'} cm · Bras ${m.arm || '—'} cm · Taille ${m.waist || '—'} cm · Cuisse ${m.thigh || '—'} cm`),
    ),
    el('button', { class: 'icon-btn danger', onClick: () => {
      state.measurements = state.measurements.filter(x => x.id !== m.id);
      save(); navigate('measurements');
    } }, '✕'),
  )));
  wrap.appendChild(list);

  setTimeout(() => {
    const arr = [...state.measurements].sort((a, b) => a.date.localeCompare(b.date));
    if (!arr.length) return;
    const labels = arr.map(m => shortDate(m.date));
    const mkSet = (label, key, color) => ({ label, data: arr.map(m => m[key]), borderColor: color, backgroundColor: color, tension: 0.3, fill: false, pointRadius: 4, spanGaps: true });
    chart($('#m-chart').getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [
        mkSet('Poitrine', 'chest', chartTheme.accent2),
        mkSet('Bras', 'arm', chartTheme.info),
        mkSet('Taille', 'waist', chartTheme.accent),
        mkSet('Cuisse', 'thigh', chartTheme.success),
      ] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: chartTheme.text } } },
        scales: baseScales('cm') }
    });
  }, 0);
  return wrap;
};

function openMeasurementForm() {
  openModal('Nouvelle mesure', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      state.measurements.push({
        id: id(), date: d.date,
        chest: d.chest ? +d.chest : null,
        arm: d.arm ? +d.arm : null,
        waist: d.waist ? +d.waist : null,
        thigh: d.thigh ? +d.thigh : null,
      });
      save(); close(); navigate('measurements'); toast('Mesure ajoutée');
    } });
    form.innerHTML = `
      <div><label>Date</label><input type="date" name="date" value="${today()}" required></div>
      <div class="form-row">
        <div><label>Poitrine (cm)</label><input type="number" step="0.5" name="chest"></div>
        <div><label>Bras (cm)</label><input type="number" step="0.5" name="arm"></div>
      </div>
      <div class="form-row">
        <div><label>Tour de taille (cm)</label><input type="number" step="0.5" name="waist"></div>
        <div><label>Cuisse (cm)</label><input type="number" step="0.5" name="thigh"></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// ---------- Photos ----------

views.photos = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Photos', 'Avant / après — documente ta transformation visuellement.',
    el('label', { class: 'btn', style: 'cursor: pointer;' }, '+ Ajouter une photo',
      el('input', { type: 'file', accept: 'image/*', hidden: '', onChange: (e) => addPhoto(e.target.files[0]) }))));

  const card = el('div', { class: 'card' });
  const photos = [...state.photos].sort((a, b) => b.date.localeCompare(a.date));
  if (!photos.length) {
    card.appendChild(emptyState('Aucune photo', 'Ajoute une première photo pour démarrer ton suivi.'));
  } else {
    const grid = el('div', { class: 'photo-grid' });
    photos.forEach(p => {
      grid.appendChild(el('div', { class: 'photo-card' },
        el('img', { src: p.data, alt: p.label }),
        el('div', { class: 'photo-meta' },
          el('div', {},
            el('div', { style: 'font-weight: 600;' }, p.label || fmtDate(p.date)),
            el('div', { style: 'color: var(--text-dim); font-size: 11px;' }, fmtDate(p.date)),
          ),
          el('button', { class: 'icon-btn danger', onClick: () => {
            state.photos = state.photos.filter(x => x.id !== p.id);
            save(); navigate('photos');
          } }, '✕'),
        ),
      ));
    });
    card.appendChild(grid);
  }
  wrap.appendChild(card);
  return wrap;
};

function addPhoto(file) {
  if (!file) return;
  if (file.size > 3_000_000) { toast('Image trop grande (max 3 MB)'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    const label = prompt('Légende (facultatif) :') || '';
    state.photos.push({
      id: id(),
      date: today(),
      label, data: e.target.result,
    });
    if (!save()) { state.photos.pop(); return; }
    navigate('photos'); toast('Photo ajoutée');
  };
  reader.readAsDataURL(file);
}

// ---------- Vidéos ----------

function parseVideo(url) {
  if (!url) return { type: 'none', src: '' };
  if (url.startsWith('data:video')) return { type: 'file', src: url };
  let m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
  if (m) return { type: 'youtube', embed: `https://www.youtube.com/embed/${m[1]}` };
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return { type: 'vimeo', embed: `https://player.vimeo.com/video/${m[1]}` };
  if (/\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url)) return { type: 'file', src: url };
  return { type: 'link', src: url };
}

function videoEmbed(v) {
  const p = parseVideo(v.data || v.url || '');
  if (p.type === 'youtube' || p.type === 'vimeo') {
    return el('iframe', { src: p.embed, loading: 'lazy',
      allow: 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen',
      allowfullscreen: '' });
  }
  if (p.type === 'file') {
    return el('video', { src: p.src, controls: '', preload: 'metadata' });
  }
  if (p.type === 'link') {
    return el('a', { class: 'video-fallback', href: p.src, target: '_blank', rel: 'noopener' }, '▶ Ouvrir la vidéo');
  }
  return el('div', { class: 'video-fallback' }, 'Vidéo indisponible');
}

views.videos = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Vidéos', 'Garde tes vidéos datées pour visionner ta progression dans le temps.',
    el('button', { class: 'btn', onClick: () => openVideoForm() }, '+ Ajouter une vidéo')));

  const card = el('div', { class: 'card' });
  const arr = [...state.videos].sort((a, b) => b.date.localeCompare(a.date));
  if (!arr.length) {
    card.appendChild(emptyState('Aucune vidéo', 'Ajoute un lien (YouTube, Vimeo, Drive…) ou un fichier court pour suivre ta progression.'));
  } else {
    const grid = el('div', { class: 'video-grid' });
    arr.forEach(v => grid.appendChild(videoCard(v)));
    card.appendChild(grid);
  }
  wrap.appendChild(card);
  return wrap;
};

function videoCard(v) {
  return el('div', { class: 'video-card' },
    el('div', { class: 'video-embed' }, videoEmbed(v)),
    el('div', { class: 'video-info' },
      el('div', { class: 'video-head' },
        el('div', {},
          el('div', { class: 'video-date' }, fmtDate(v.date)),
          v.title ? el('div', { class: 'video-title' }, v.title) : null,
        ),
        el('button', { class: 'icon-btn danger', onClick: () => {
          state.videos = state.videos.filter(x => x.id !== v.id); save(); navigate('videos'); toast('Vidéo supprimée');
        } }, '✕'),
      ),
      v.notes ? el('div', { class: 'video-notes' }, v.notes) : null,
    ),
  );
}

function openVideoForm() {
  openModal('Ajouter une vidéo', (close) => {
    let fileData = null;
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const url = (d.url || '').trim();
      if (!url && !fileData) { toast('Ajoute un lien ou un fichier vidéo.'); return; }
      const entry = { id: id(), date: d.date, title: (d.title || '').trim(), url, data: fileData, notes: (d.notes || '').trim() };
      state.videos.push(entry);
      if (!save()) { state.videos.pop(); return; }
      close(); navigate('videos'); toast('Vidéo ajoutée');
    } });
    form.innerHTML = `
      <div class="form-row">
        <div><label>Date</label><input type="date" name="date" value="${today()}" required></div>
        <div><label>Titre</label><input type="text" name="title" placeholder="ex : Service revers, semaine 3"></div>
      </div>
      <div><label>Lien vidéo</label><input type="url" name="url" placeholder="https://youtube.com/… ou Vimeo, Drive…"></div>
      <div><label>… ou importer un fichier court</label><input type="file" accept="video/*" name="file"></div>
      <p class="form-hint">Recommandé : un lien (YouTube, Vimeo, Drive). Les fichiers volumineux risquent de ne pas être sauvegardés.</p>
      <div><label>Notes</label><textarea name="notes" placeholder="Ce que tu observes, axes de travail…"></textarea></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    const fileInput = form.querySelector('input[type=file]');
    fileInput.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) { fileData = null; return; }
      if (f.size > 20_000_000) { toast('Fichier trop lourd (max ~20 Mo). Préfère un lien.'); fileInput.value = ''; fileData = null; return; }
      const reader = new FileReader();
      reader.onload = (ev) => { fileData = ev.target.result; };
      reader.readAsDataURL(f);
    });
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// ---------- Saisie simple générique ----------

function simpleEntryForm(category, opts) {
  openModal('Nouvelle entrée', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      state[category].push({ id: id(), date: d.date, [opts.field]: +d[opts.field] });
      save(); close(); navigate(category); toast('Entrée ajoutée');
    } });
    form.innerHTML = `
      <div class="form-row">
        <div><label>Date</label><input type="date" name="date" value="${today()}" required></div>
        <div><label>${opts.label}</label><input type="${opts.type}" step="${opts.step || '1'}" name="${opts.field}" required></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// ---------- Goals ----------

views.goals = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Objectifs', 'Définis tes objectifs datés et suis ta progression.',
    el('button', { class: 'btn', onClick: () => openGoalForm() }, '+ Nouvel objectif')));

  const active = state.goals.filter(g => !g.done);
  const done = state.goals.filter(g => g.done);

  const card1 = el('div', { class: 'card' }, el('h3', {}, 'En cours'));
  if (!active.length) card1.appendChild(emptyState('Aucun objectif actif', ''));
  active.forEach(g => card1.appendChild(goalRow(g, true)));
  wrap.appendChild(card1);

  if (done.length) {
    const card2 = el('div', { class: 'card', style: 'margin-top: 16px;' }, el('h3', {}, 'Terminés'));
    done.forEach(g => card2.appendChild(goalRow(g, true)));
    wrap.appendChild(card2);
  }

  return wrap;
};

function goalRow(g, withControls) {
  const daysLeft = Math.ceil((new Date(g.deadline) - new Date()) / 86400000);
  const wrap = el('div', { class: 'list-item', style: 'flex-direction: column; align-items: stretch; gap: 8px;' });
  const head = el('div', { style: 'display: flex; justify-content: space-between; gap: 12px; align-items: center;' },
    el('div', {},
      el('div', { class: 'title', style: g.done ? 'text-decoration: line-through; color: var(--text-dim);' : '' }, g.title),
      el('div', { class: 'meta' },
        `Échéance : ${fmtDate(g.deadline)} · ${g.done ? 'Atteint ✓' : (daysLeft >= 0 ? `${daysLeft} jours restants` : `En retard de ${-daysLeft} jours`)}`),
    ),
    withControls ? el('div', { class: 'actions' },
      el('button', { class: 'icon-btn', title: 'Marquer comme atteint', onClick: () => {
        g.done = !g.done; if (g.done) g.progress = 100;
        save(); navigate('goals'); toast(g.done ? 'Objectif atteint !' : 'Objectif réactivé');
      } }, g.done ? '↺' : '✓'),
      el('button', { class: 'icon-btn', onClick: () => openGoalForm(g) }, '✎'),
      el('button', { class: 'icon-btn danger', onClick: () => confirmAction('Supprimer cet objectif ?', () => {
        state.goals = state.goals.filter(x => x.id !== g.id); save(); navigate('goals');
      }) }, '✕'),
    ) : null,
  );
  wrap.appendChild(head);
  const bar = el('div', { class: 'progress' }, el('div', { class: 'progress-fill', style: `width: ${g.progress || 0}%` }));
  wrap.appendChild(bar);
  wrap.appendChild(el('div', { style: 'font-size: 11px; color: var(--text-dim);' }, `Progression : ${g.progress || 0}%`));
  return wrap;
}

function openGoalForm(existing) {
  const g = existing || { title: '', deadline: '', progress: 0, done: false };
  openModal(existing ? 'Modifier l\'objectif' : 'Nouvel objectif', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const entry = { id: existing?.id || id(), title: d.title.trim(), deadline: d.deadline, progress: +d.progress, done: existing?.done || false };
      if (existing) state.goals = state.goals.map(x => x.id === entry.id ? entry : x);
      else state.goals.push(entry);
      save(); close(); navigate('goals'); toast(existing ? 'Objectif mis à jour' : 'Objectif créé');
    } });
    form.innerHTML = `
      <div><label>Titre</label><input type="text" name="title" value="${g.title || ''}" placeholder="Ex : Courir un 10 km en moins de 50 min" required></div>
      <div class="form-row">
        <div><label>Échéance</label><input type="date" name="deadline" value="${g.deadline || ''}" required></div>
        <div><label>Progression (%)</label><input type="number" min="0" max="100" name="progress" value="${g.progress || 0}"></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// ---------- Recovery ----------

views.recovery = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Récupération', 'Garde un œil sur ta fatigue et tes douleurs pour ne pas te cramer.',
    el('button', { class: 'btn', onClick: () => openRecoveryForm() }, '+ Nouvelle entrée')));

  const arr = [...state.recovery].sort((a, b) => a.date.localeCompare(b.date));
  const last = arr.at(-1);

  if (last) {
    const kpis = el('div', { class: 'grid cols-3' });
    kpis.appendChild(kpiCard('😮‍💨 Fatigue', `${last.fatigue}/5`, fmtDate(last.date), last.fatigue >= 4 ? 'danger' : 'success'));
    kpis.appendChild(kpiCard('💢 Douleurs', `${last.pain}/5`, fmtDate(last.date), last.pain >= 4 ? 'danger' : 'success'));
    kpis.appendChild(kpiCard('🗓️ Entrées', String(arr.length), 'au total'));
    wrap.appendChild(kpis);
    wrap.appendChild(el('div', { style: 'height: 16px;' }));
  }

  const chartCard = el('div', { class: 'card' }, el('h3', {}, 'Évolution sur la durée'),
    el('div', { class: 'chart-wrap tall' }, el('canvas', { id: 'rec-chart' })));
  wrap.appendChild(chartCard);

  const list = el('div', { class: 'card', style: 'margin-top: 16px;' }, el('h3', {}, 'Journal'));
  if (!arr.length) list.appendChild(emptyState('Aucune entrée', 'Commence ton journal de récupération.'));
  [...arr].reverse().forEach(r => list.appendChild(el('div', { class: 'list-item' },
    el('div', {},
      el('div', { class: 'title' }, fmtDate(r.date)),
      el('div', { class: 'meta' },
        `Fatigue ${r.fatigue}/5 · Douleurs ${r.pain}/5${r.notes ? ' · ' + r.notes : ''}`),
    ),
    el('button', { class: 'icon-btn danger', onClick: () => {
      state.recovery = state.recovery.filter(x => x.id !== r.id); save(); navigate('recovery');
    } }, '✕'),
  )));
  wrap.appendChild(list);

  setTimeout(() => {
    if (!arr.length) return;
    chart($('#rec-chart').getContext('2d'), {
      type: 'line',
      data: {
        labels: arr.map(r => shortDate(r.date)),
        datasets: [
          { label: 'Fatigue', data: arr.map(r => r.fatigue), borderColor: chartTheme.accent, backgroundColor: 'rgba(255,91,46,0.15)', tension: 0.3, fill: true, pointRadius: 4 },
          { label: 'Douleurs', data: arr.map(r => r.pain), borderColor: chartTheme.accent2, backgroundColor: chartTheme.accent2, tension: 0.3, fill: false, pointRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: chartTheme.text } } },
        scales: {
          x: { ticks: { color: chartTheme.text }, grid: { color: chartTheme.grid } },
          y: { min: 0, max: 5, ticks: { color: chartTheme.text, stepSize: 1 }, grid: { color: chartTheme.grid }, title: { display: true, text: '/5', color: chartTheme.text } },
        },
      },
    });
  }, 0);

  return wrap;
};

function openRecoveryForm() {
  openModal('Nouvelle entrée de récupération', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      state.recovery.push({
        id: id(), date: d.date,
        fatigue: +d.fatigue, pain: +d.pain,
        notes: (d.notes || '').trim(),
      });
      save(); close(); navigate('recovery'); toast('Entrée ajoutée');
    } });
    form.innerHTML = `
      <div class="form-row">
        <div><label>Date</label><input type="date" name="date" value="${today()}" required></div>
        <div><label>Fatigue (/5)</label><input type="number" min="0" max="5" name="fatigue" value="2" required></div>
      </div>
      <div><label>Douleurs (/5)</label><input type="number" min="0" max="5" name="pain" value="1" required></div>
      <div><label>Notes</label><textarea name="notes" placeholder="Zones tendues, ressenti…"></textarea></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// =============================================================
// Import / Export / Reset
// =============================================================

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `athelio-${today()}.json`;
  a.click();
  toast('Données exportées');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      state = migrate(JSON.parse(e.target.result));
      save();
      navigate(currentView);
      toast('Données importées');
    } catch {
      toast('Fichier invalide');
    }
  };
  reader.readAsText(file);
}

function resetData() {
  confirmAction('Effacer toutes les données ? Cette action est irréversible.', () => {
    localStorage.removeItem(STORAGE_KEY);
    state = seed();
    save();
    navigate('dashboard');
    toast('Données réinitialisées');
  });
}

// =============================================================
// Boot
// =============================================================

document.addEventListener('DOMContentLoaded', () => {
  $$('.nav-btn').forEach(b => b.addEventListener('click', () => navigate(b.dataset.view)));
  $('#export-btn').addEventListener('click', exportData);
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); });
  $('#reset-btn').addEventListener('click', resetData);
  navigate('dashboard');
});
