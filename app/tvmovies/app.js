(function () {
  'use strict';

  var API = 'http://192.168.0.10:8089';
  var IMG = 'https://image.tmdb.org/t/p/';
  var POSTER_SIZE = 'w342';
  var BACKDROP_SIZE = 'w1280';
  var HERO_ROTATE_MS = 12000;
  var REFRESH_MS = 300000;
  var IDLE_MS = 120000;

  var ROWS_CONFIG = [
    { id: 'foryou', title: 'For You', url: '/api/picks', params: { min: '6' } },
    { id: 'new', title: 'New & Good', url: '/api/explore', params: { list: 'new', min: '6' } },
    { id: 'action', title: 'Action', url: '/api/explore', params: { genre: 'Action', min: '6' } },
    { id: 'thriller', title: 'Thriller', url: '/api/explore', params: { genre: 'Thriller', min: '6' } },
    { id: 'horror', title: 'Horror', url: '/api/explore', params: { genre: 'Horror', min: '6' } },
    { id: 'scifi', title: 'Sci-Fi', url: '/api/explore', params: { genre: 'Sci-Fi', min: '6' } },
    { id: 'comedy', title: 'Comedy', url: '/api/explore', params: { genre: 'Comedy', min: '6' } },
    { id: 'drama', title: 'Drama', url: '/api/explore', params: { genre: 'Drama', min: '6' } },
    { id: 'indian', title: 'Indian Cinema', url: '/api/explore', params: { list: 'indian', min: '6' } },
    { id: 'animation', title: 'Animation', url: '/api/explore', params: { genre: 'Animation', min: '6' } },
    { id: 'crime', title: 'Crime', url: '/api/explore', params: { genre: 'Crime', min: '6' } },
    { id: 'mystery', title: 'Mystery', url: '/api/explore', params: { genre: 'Mystery', min: '6' } },
    { id: 'top', title: 'IMDb Top', url: '/api/explore', params: { list: 'top' } },
    { id: 'mind', title: 'Mind-Benders', url: '/api/explore', params: { list: 'mind', min: '6' } },
    { id: 'heist', title: 'Heists & Cons', url: '/api/explore', params: { list: 'heist', min: '6' } },
    { id: 'gems', title: 'Hidden Gems', url: '/api/explore', params: { list: 'gems' } }
  ];

  // --- State ----------------------------------------------------------------
  var rows = [];
  var focusZone = 'rows';
  var focusRow = 0;
  var focusCol = 0;
  var heroFilm = null;
  var heroDetail = null;
  var heroBtnIdx = 0;
  var heroButtons = [];
  var heroTimer = null;
  var toastTimer = null;
  var idleTimer = null;
  var loading = false;
  var savedFocusRow = 0;
  var savedFocusCol = 0;

  // --- Helpers --------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  }); }

  function runtime(min) {
    if (!min) return '';
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm';
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  var pending = [];
  function luna(uri, params) {
    try {
      var b = new PalmServiceBridge();
      pending.push(b);
      b.onservicecallback = function () { pending.splice(pending.indexOf(b), 1); };
      b.call(uri, JSON.stringify(params || {}));
    } catch (e) { /* not on a TV */ }
  }

  async function get(path) {
    var res = await fetch(API + path, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  async function post(path, body) {
    var res = await fetch(API + path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', 'X-Movies': '1' }
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || res.status);
    return data;
  }

  function toast(text) {
    var el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3000);
  }

  // --- OLED idle: let screensaver activate after inactivity -----------------
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      clearInterval(heroTimer);
    }, IDLE_MS);
  }

  // --- Data loading ---------------------------------------------------------
  async function loadRow(row) {
    var q = new URLSearchParams(Object.assign({ limit: '30' }, row.config.params));
    try {
      var data = await get(row.config.url + '?' + q);
      row.films = shuffle(data.items || []);
    } catch (e) {
      if (!row.films.length) row.films = [];
    }
  }

  async function loadAllRows(preserveFocus) {
    if (loading) return;
    loading = true;
    if (preserveFocus) { savedFocusRow = focusRow; savedFocusCol = focusCol; }
    await Promise.all(rows.map(loadRow));
    loading = false;
    if (preserveFocus) { focusRow = savedFocusRow; focusCol = savedFocusCol; }
    renderRows();
    if (!heroFilm && rows.length && rows[0].films.length) {
      setHeroFilm(rows[0].films[0]);
    }
  }

  async function loadMovieDetail(id) {
    try { return await get('/api/movie/' + id); } catch (e) { return null; }
  }

  // --- Hero -----------------------------------------------------------------
  function setHeroFilm(film) {
    if (heroFilm && heroFilm.id === film.id) return;
    heroFilm = film;
    heroDetail = null;

    var bd = $('hero-backdrop');
    if (film.poster) {
      bd.style.backgroundImage = 'url(' + IMG + BACKDROP_SIZE + (film.backdrop || film.poster) + ')';
    } else {
      bd.style.backgroundImage = 'none';
    }
    bd.style.opacity = '1';

    $('hero-rating').textContent = film.rating ? '★ ' + film.rating.toFixed(1) : '';
    $('hero-title').textContent = film.title + (film.year ? ' (' + film.year + ')' : '');

    var meta = [];
    if (film.runtime) meta.push(runtime(film.runtime));
    if (film.genres && film.genres.length) meta.push(film.genres.slice(0, 3).join(' \xb7 '));
    if (film.lang && film.lang !== 'en') meta.push(film.lang.toUpperCase());
    $('hero-meta').textContent = meta.join('  \xb7  ');
    $('hero-overview').textContent = '';

    updateHeroActions(film);

    loadMovieDetail(film.id).then(function (detail) {
      if (!heroFilm || heroFilm.id !== film.id) return;
      heroDetail = detail;
      if (detail) {
        if (detail.overview) $('hero-overview').textContent = detail.overview;
        if (detail.backdrop) {
          bd.style.backgroundImage = 'url(' + IMG + BACKDROP_SIZE + detail.backdrop + ')';
        }
        updateHeroActions(detail);
      }
    });
  }

  function updateHeroActions(film) {
    var getBtn = $('act-get');
    var watchBtn = $('act-watchlist');
    var trailerBtn = $('act-trailer');

    if (film.lib === 'library') {
      getBtn.innerHTML = '<span class="icon">▶</span> Play';
      getBtn.dataset.act = 'play';
      getBtn.hidden = false;
    } else if (film.lib === 'requested') {
      getBtn.innerHTML = '<span class="icon">↓</span> Downloading…';
      getBtn.dataset.act = 'none';
      getBtn.hidden = false;
    } else if (film.tmdb || (heroDetail && heroDetail.tmdb)) {
      getBtn.innerHTML = '<span class="icon">↓</span> Get It';
      getBtn.dataset.act = 'get';
      getBtn.hidden = false;
    } else {
      getBtn.hidden = true;
    }

    var inWatch = film.mark === 'watchlist';
    watchBtn.innerHTML = inWatch
      ? '<span class="icon">✓</span> On Watchlist'
      : '<span class="icon">+</span> Watchlist';
    watchBtn.classList.toggle('on', inWatch);

    trailerBtn.hidden = false;

    heroButtons = [trailerBtn, getBtn, watchBtn].filter(function (b) { return !b.hidden; });
    if (heroBtnIdx >= heroButtons.length) heroBtnIdx = 0;
    renderHeroFocus();
  }

  function renderHeroFocus() {
    heroButtons.forEach(function (b, i) {
      b.classList.toggle('focus', focusZone === 'hero' && i === heroBtnIdx);
    });
  }

  // --- Trailer: launch YouTube TV app instead of embedding ------------------
  function openTrailer() {
    if (!heroFilm) return;
    var ytId = heroDetail && heroDetail.trailer;
    var url;
    if (ytId) {
      url = 'https://www.youtube.com/watch?v=' + encodeURIComponent(ytId);
    } else {
      var q = (heroFilm.title || '') + ' ' + (heroFilm.year || '') + ' trailer';
      url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q.trim());
    }
    luna('luna://com.webos.applicationManager/launch', {
      id: 'youtube.leanback.v4',
      params: { contentTarget: url }
    });
  }

  // --- Hero auto-rotate -----------------------------------------------------
  function startHeroRotate() {
    clearInterval(heroTimer);
    heroTimer = setInterval(function () {
      if (focusZone === 'hero') return;
      var row = rows[0];
      if (!row || !row.films.length) return;
      var idx = row.films.indexOf(heroFilm);
      var next = (idx + 1) % Math.min(row.films.length, 10);
      setHeroFilm(row.films[next]);
    }, HERO_ROTATE_MS);
  }

  // --- Rows rendering -------------------------------------------------------
  function renderRows() {
    var container = $('rows-inner');
    var ld = container.querySelector('.loading');
    if (ld && !ld.closest('.row')) container.removeChild(ld);
    rows.forEach(function (row, ri) {
      if (!row.el) {
        row.el = document.createElement('div');
        row.el.className = 'row';
        row.el.innerHTML = '<h2 class="row-title">' + esc(row.config.title) + '</h2><div class="row-cards"></div>';
        row.cardsEl = row.el.querySelector('.row-cards');
        container.appendChild(row.el);
      }
      row.el.classList.toggle('active', ri === focusRow);

      row.cardsEl.innerHTML = '';
      if (!row.films.length) {
        row.cardsEl.innerHTML = '<div class="loading" style="height:100px;font-size:16px">No films</div>';
        return;
      }
      row.films.forEach(function (film, ci) {
        var card = document.createElement('div');
        card.className = 'card' + (focusZone === 'rows' && ri === focusRow && ci === focusCol ? ' focus' : '');

        var poster = film.poster
          ? '<img src="' + IMG + POSTER_SIZE + esc(film.poster) + '" alt="" loading="lazy">'
          : '<span class="ph">' + esc(film.title) + '</span>';

        var badge = film.rating ? '<span class="card-badge">★ ' + film.rating.toFixed(1) + '</span>' : '';
        var pills = '';
        if (film.lib === 'library') pills = '<span class="card-pill lib">▶ Jellyfin</span>';
        else if (film.lib === 'requested') pills = '<span class="card-pill req">Downloading</span>';
        var getPill = (film.lib !== 'library' && film.lib !== 'requested')
          ? '<span class="card-pill get">↓ Get It</span>' : '';

        card.innerHTML = '<div class="card-poster">' + poster + badge +
          '<div class="card-lib">' + pills + getPill + '</div></div>' +
          '<div class="card-title">' + esc(film.title) + '</div>' +
          '<div class="card-year">' + esc(film.year || '') + '</div>';
        row.cardsEl.appendChild(card);
      });
    });
    scrollRow();
    scrollRows();
  }

  function scrollRow() {
    var row = rows[focusRow];
    if (!row || !row.cardsEl) return;
    var offset = Math.max(0, focusCol - 2);
    row.cardsEl.style.transform = 'translateX(' + (-offset * 234) + 'px)';
  }

  function scrollRows() {
    var inner = $('rows-inner');
    var offset = 0;
    for (var i = 0; i < focusRow && i < rows.length; i++) {
      if (rows[i].el) offset += rows[i].el.offsetHeight;
    }
    inner.style.transform = 'translateY(' + (-offset) + 'px)';
  }

  function updateCardFocus() {
    var allCards = document.querySelectorAll('.card');
    allCards.forEach(function (c) { c.classList.remove('focus'); });
    if (focusZone !== 'rows') return;
    var row = rows[focusRow];
    if (!row) return;
    var card = row.cardsEl.children[focusCol];
    if (card) card.classList.add('focus');
    scrollRow();
  }

  // --- Actions --------------------------------------------------------------
  async function doGetIt() {
    if (!heroFilm) return;
    if (heroFilm.lib === 'library') {
      luna('luna://com.webos.applicationManager/launch', { id: 'org.moonfin.webos' });
      return;
    }
    if (heroFilm.lib === 'requested') { toast('Already downloading'); return; }
    toast('Requesting…');
    try {
      await post('/api/request', { id: heroFilm.id });
      heroFilm.lib = 'requested';
      updateHeroActions(heroFilm);
      toast('Requested — Radarr will fetch it');
      syncFilmState(heroFilm);
    } catch (e) { toast('Failed: ' + e.message); }
  }

  async function doWatchlist() {
    if (!heroFilm) return;
    var inWatch = heroFilm.mark === 'watchlist';
    var newList = inWatch ? 'none' : 'watchlist';
    try {
      await post('/api/mark', { id: heroFilm.id, list: newList, verdict: null });
      heroFilm.mark = newList === 'none' ? null : 'watchlist';
      updateHeroActions(heroFilm);
      toast(inWatch ? 'Removed from watchlist' : 'Added to watchlist');
    } catch (e) { toast('Failed: ' + e.message); }
  }

  function syncFilmState(film) {
    rows.forEach(function (row) {
      row.films.forEach(function (f) {
        if (f.id === film.id) { f.lib = film.lib; f.mark = film.mark; }
      });
    });
    renderRows();
  }

  function doHeroAction() {
    var btn = heroButtons[heroBtnIdx];
    if (!btn) return;
    var act = btn.dataset.act;
    if (act === 'trailer') openTrailer();
    else if (act === 'get' || act === 'play') doGetIt();
    else if (act === 'watchlist') doWatchlist();
  }

  async function quickGetIt() {
    if (focusZone !== 'rows') return;
    var row = rows[focusRow];
    if (!row) return;
    var film = row.films[focusCol];
    if (!film) return;
    if (film.lib === 'library') { toast('Already in Jellyfin'); return; }
    if (film.lib === 'requested') { toast('Already downloading'); return; }
    toast('Requesting ' + film.title + '…');
    try {
      await post('/api/request', { id: film.id });
      film.lib = 'requested';
      heroFilm = null;
      setHeroFilm(film);
      renderRows();
      toast(film.title + ' — downloading');
    } catch (e) { toast('Failed: ' + e.message); }
  }

  // --- Navigation -----------------------------------------------------------
  function nav(dir) {
    resetIdle();
    clearInterval(heroTimer);
    startHeroRotate();

    if (focusZone === 'hero') {
      switch (dir) {
        case 'left':
          heroBtnIdx = Math.max(0, heroBtnIdx - 1);
          renderHeroFocus();
          break;
        case 'right':
          heroBtnIdx = Math.min(heroButtons.length - 1, heroBtnIdx + 1);
          renderHeroFocus();
          break;
        case 'down':
          focusZone = 'rows';
          renderHeroFocus();
          updateCardFocus();
          break;
        case 'enter':
          doHeroAction();
          break;
        case 'back':
          focusZone = 'rows';
          renderHeroFocus();
          updateCardFocus();
          break;
      }
      return;
    }

    // Zone: rows
    var row = rows[focusRow];
    if (!row || !row.films.length) return;

    switch (dir) {
      case 'left':
        if (focusCol > 0) { focusCol--; updateCardFocus(); updateHeroFromFocus(); }
        break;
      case 'right':
        if (focusCol < row.films.length - 1) { focusCol++; updateCardFocus(); updateHeroFromFocus(); }
        break;
      case 'up':
        if (focusRow > 0) {
          focusRow--;
          focusCol = Math.min(focusCol, (rows[focusRow].films.length || 1) - 1);
          rows.forEach(function (r, i) { r.el.classList.toggle('active', i === focusRow); });
          updateCardFocus();
          scrollRows();
          updateHeroFromFocus();
        } else {
          focusZone = 'hero';
          heroBtnIdx = 0;
          updateCardFocus();
          renderHeroFocus();
        }
        break;
      case 'down':
        if (focusRow < rows.length - 1) {
          focusRow++;
          focusCol = Math.min(focusCol, (rows[focusRow].films.length || 1) - 1);
          rows.forEach(function (r, i) { r.el.classList.toggle('active', i === focusRow); });
          updateCardFocus();
          scrollRows();
          updateHeroFromFocus();
        }
        break;
      case 'enter':
        openTrailer();
        break;
      case 'green':
        quickGetIt();
        break;
      case 'back':
        try { window.close(); } catch (e) {}
        break;
    }
  }

  function updateHeroFromFocus() {
    if (focusZone !== 'rows') return;
    var row = rows[focusRow];
    if (!row || !row.films[focusCol]) return;
    setHeroFilm(row.films[focusCol]);
  }

  // --- Input ----------------------------------------------------------------
  document.addEventListener('keydown', function (e) {
    var map = {
      37: 'left', 39: 'right', 38: 'up', 40: 'down',
      13: 'enter', 461: 'back', 8: 'back',
      403: 'red', 404: 'green', 405: 'yellow', 406: 'blue'
    };
    var dir = map[e.keyCode];
    if (dir) { e.preventDefault(); nav(dir); }
  });

  var pointer = false;
  document.addEventListener('cursorStateChange', function (e) {
    pointer = !!(e.detail && e.detail.visibility);
  });

  // --- Visibility -----------------------------------------------------------
  function isHidden() { return document.hidden || document.webkitHidden; }
  document.addEventListener('visibilitychange', function () {
    if (isHidden()) { clearInterval(heroTimer); }
    else { startHeroRotate(); resetIdle(); }
  });
  document.addEventListener('webkitvisibilitychange', function () {
    if (isHidden()) { clearInterval(heroTimer); }
    else { startHeroRotate(); resetIdle(); }
  });
  document.addEventListener('webOSRelaunch', function () {
    try { PalmSystem.activate(); } catch (e) {}
    if (!isHidden()) { loadAllRows(true); startHeroRotate(); resetIdle(); }
  });

  // --- Init -----------------------------------------------------------------
  async function init() {
    rows = ROWS_CONFIG.map(function (config) {
      return { config: config, films: [], el: null, cardsEl: null };
    });

    var container = $('rows-inner');
    container.innerHTML = '<div class="loading">Loading movies…</div>';

    await loadAllRows();
    startHeroRotate();
    resetIdle();

    setInterval(function () {
      if (!isHidden()) loadAllRows(true);
    }, REFRESH_MS);
  }

  init();
})();
