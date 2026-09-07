/* =============================================================================
 * i18n.js - the globalization layer.
 *
 * ONE SOURCE LANGUAGE, MANY SURFACES. Every string in this platform - the
 * interface chrome AND the text held in the database - is authored in English.
 * A translation is never a second copy of a record: it is a row in
 * `translation` pointing at the DISTINCT source string in `phrase`, so the same
 * wording is translated once and reused everywhere it appears.
 *
 * The languages themselves are a DATABASE TABLE (`language`), not a coded list,
 * so an administrator adds one in the Globalization panel and the switcher, the
 * catalogue and the background translator all pick it up with no code change.
 *
 * HOW THE WHOLE INTERFACE TRANSLATES WITHOUT A KEY ON EVERY LABEL. The app
 * renders in English; this layer then swaps rendered text for the active
 * language on the way to the screen:
 *   1. a TreeWalker rewrites text nodes and the translatable attributes
 *      (placeholder / title / aria-label / alt / value) of a subtree;
 *   2. a MutationObserver runs that pass over anything rendered afterwards, so
 *      every modal, table, chart label and message is covered as it appears;
 *   3. each node remembers its own source text, so switching back to English
 *      restores the original exactly.
 * Only strings the catalogue knows are replaced - anything else is left alone,
 * which is what makes the pass safe over live data.
 *
 * WHERE THE WORDS COME FROM. The vocabulary is SHIPPED, in js/catalog.js, and
 * merged into the database on every start - so a platform that has been running
 * for a year still receives new wording, and an install with no network reads
 * correctly from the first paint. That file is application content and is
 * deliberately separate from js/seed.js, which is demo data.
 *
 * Two things happen to a string the catalogue does not know:
 *   - met ON SCREEN - it is CATALOGUED only, so an administrator can see it in
 *     the Globalization panel and give it wording. It is not sent anywhere. A
 *     screen surfaces hundreds of incidental strings a minute, and commissioning
 *     a translation for each on sight is a permanent trickle of requests for
 *     wording nobody asked for.
 *   - WRITTEN AS A RECORD - a new project, activity or partner IS translated in
 *     the background as it is saved, because that is content the platform is
 *     expected to speak back.
 * Personal data (names, usernames, emails), postal addresses, settlement names,
 * codes and acronyms are never translated and never leave the browser.
 *
 * Everything a machine produced is marked `auto`; anything an administrator
 * edits in the Globalization panel is marked reviewed and is never overwritten.
 * ========================================================================== */
(function () {
  'use strict';

  var LANG_COOKIE = 'gr_lang';         // remembered language choice (per browser)
  var SETTINGS_KEY = 'gr_i18n_settings';
  var SOURCE_FALLBACK = 'en';          // used only before the language table loads

  // Attributes that carry visible prose. `value` is included for button-like
  // inputs only (never for a field the user types into).
  var TEXT_ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  // Never walked: script/style hold code, textarea holds what the user typed.
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1 };

  // PROSE BLOCKS. A help note is written as one sentence with <b> in the middle
  // of it, which reaches the DOM as three text nodes: "...shows the plan's",
  // "projects", ", grouped by Impact". Translating those separately cannot
  // produce a correct Arabic sentence - the word order is not the same - so
  // these elements are translated whole and rendered as plain text. The markup
  // is remembered, so switching back to English restores the emphasis.
  // Only STATIC prose belongs here. A line that interpolates a count, a date or a
  // name is never the same string twice, so it would never match the catalogue -
  // those stay on the text-node path, where the number is left alone and the
  // words around it are translated.
  var PROSE_SEL = '.cp-note,.about-lead,.empty,.re-empty,.place-loading,.rp-tgt,.gl-stat,.comm-prev-lbl';

  // Columns that hold PROSE. `address` is deliberately absent: a postal address
  // must stay legible to the postal service that will deliver to it, which is
  // the destination country's, not the reader's - so it is carried through
  // exactly as entered, like a name or a code.
  var TEXT_COLUMNS = {
    name: 1, short_name: 1, acronym: 1, statement: 1, description: 1,
    narrative: 1, assumptions: 1, risks: 1, pillar_name: 1, summary: 1,
    means_of_verification: 1, ref_name: 1, place_name: 1
  };
  // Tables whose text is identity, not prose: personal data, the catalogue
  // itself, and the generated report artefacts.
  var SKIP_TABLES = { user: 1, language: 1, phrase: 1, translation: 1, report: 1 };
  // Fields an earlier release translated and no longer should. Their stored
  // translations are withdrawn on the next start (see I18N.reconcile).
  var RETIRED_COLUMNS = { address: 1 };

  // Help notes run long. The cap exists to keep a pasted document out of the
  // catalogue, not to exclude a paragraph the platform itself wrote.
  var MAX_SOURCE_LEN = 1400;
  var QUEUE_LIMIT = 4000;        // hard ceiling on pending strings per session
  var BATCH_SIZE = 24;           // strings handed to the provider per pass
  var BATCH_PAUSE = 900;         // ms between passes - free services are rate-limited

  // ==========================================================================
  //  State
  // ==========================================================================
  var I18N = {
    lang: SOURCE_FALLBACK,       // active language key
    source: SOURCE_FALLBACK,     // the language the app is authored in
    ready: false,
    onChange: null,              // app hook: fired after a language switch
    onProgress: null,            // panel hook: fired as the queue drains
    stats: { pending: 0, done: 0, failed: 0 }
  };

  var DICT = {};                 // active language: source text -> translated text
  var DICT_CI = {};              // the same, keyed on lower case, so 'Projects' answers 'projects'
  var KNOWN = {};                // source text -> phrase row (whole catalogue)
  var NEVER = {};                // source text -> 1 : never translate, never send
  var NEVER_RE = null;           // the same set as one pattern, for containment tests
  var NO_AUTO = {};              // catalogued, but never sent to a machine unasked
  var PENDING = [];              // source strings queued for the background service
  var QUEUED = {};               // membership test for PENDING
  var NOTED = {};                // strings already buffered for the catalogue
  var FAILED = {};               // strings the service could not translate this session
  var WORKING = false;
  var SUSPEND = 0;               // >0 while our own DOM writes are in flight
  var OBSERVER = null;
  var PASS_SCHEDULED = false;
  var DIRTY = [];                // roots awaiting a translation pass

  // ==========================================================================
  //  Settings (per browser - which service to use, and whether to use one)
  // ==========================================================================
  var SETTINGS = {
    auto: true,                  // translate new strings in the background
    endpoint: '',                // optional LibreTranslate-compatible endpoint
    apiKey: ''
  };
  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (typeof o.auto === 'boolean') SETTINGS.auto = o.auto;
        if (typeof o.endpoint === 'string') SETTINGS.endpoint = o.endpoint;
        if (typeof o.apiKey === 'string') SETTINGS.apiKey = o.apiKey;
      }
    } catch (e) {}
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); } catch (e) {}
  }

  // ==========================================================================
  //  Small helpers
  // ==========================================================================
  function setCookie(name, val) {
    var d = new Date(); d.setTime(d.getTime() + 365 * 864e5);
    try { document.cookie = name + '=' + encodeURIComponent(val) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax'; } catch (e) {}
  }
  function getCookie(name) {
    var m = ('; ' + document.cookie).split('; ' + name + '=');
    return m.length === 2 ? decodeURIComponent(m.pop().split(';').shift()) : null;
  }
  function nowISO() { return new Date().toISOString(); }
  /** A catalogue write is best-effort bookkeeping: if the store refuses it, the
   *  app carries on in English rather than dying on an unhandled rejection. */
  function swallow(p) {
    if (p && typeof p.then === 'function') p.then(null, function () {});
    return p;
  }
  function rows(t) { return (window.DB && DB.tables && DB.tables[t]) || []; }

  /** A string worth putting in the catalogue: it has Latin words, it is not an
   *  identifier / number / email / URL, and it is short enough to be a label.
   *
   *  The identifier test matters more than it looks: a project code like
   *  PRJ-CIV-P1-02 is Latin letters and would sail through, and a translation
   *  service will happily "improve" it into PRJ - CIV - P. So anything written
   *  without a single lower-case letter AND carrying a digit or a separator is
   *  read as a code, not as prose, and is left exactly as it was authored. */
  var DATE_RE = /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/;
  function translatable(s) {
    if (!s) return false;
    var t = String(s);
    if (t.length > MAX_SOURCE_LEN) return false;
    if (!/[A-Za-z]{2}/.test(t)) return false;               // needs real words
    if (!/[a-z]/.test(t) && t.length <= 8 && !/\s/.test(t)) return false;  // FCDO, KOICA, DANIDA, MDTF
    if (!/[a-z]/.test(t) && /[0-9_\/.-]/.test(t)) return false;   // PRJ-CIV-P1-02, SEC-3.1, KPI 1.2.1
    if (/^\s*[\w.+-]+@[\w.-]+\.\w+\s*$/.test(t)) return false;  // email
    if (/^\s*(https?:\/\/|www\.)/i.test(t)) return false;   // URL
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(t)) return false;  // bare domain: brightfutures.ngo
    if (NEVER[t] || ADDRESSES[t]) return false;
    if (DATE_RE.test(t)) return false;                     // per-row tooltips quoting a date
    if (containsPrivate(t)) return false;
    return true;
  }

  /** Split a rendered string into [prefix, core, suffix] where the core is the
   *  part bounded by letters. Lets "7 projects", "Impact 1.2" and "✕ Clear
   *  filters" resolve through the same catalogue entry as the bare wording. */
  var CORE_RE = /^([^A-Za-z]*)([\s\S]*?)([^A-Za-z]*)$/;
  function splitCore(s) {
    var m = CORE_RE.exec(s);
    return m ? [m[1], m[2], m[3]] : ['', s, ''];
  }

  // ==========================================================================
  //  Catalogue
  // ==========================================================================
  function langRows() {
    return rows('language').slice().sort(function (a, b) {
      var as = a.seq == null ? 1e9 : a.seq, bs = b.seq == null ? 1e9 : b.seq;
      return as - bs || String(a.name || '').localeCompare(String(b.name || ''));
    });
  }
  I18N.languages = function () { return langRows(); };
  I18N.enabledLanguages = function () { return langRows().filter(function (l) { return l.enabled !== 0; }); };
  I18N.languageByKey = function (key) {
    var hit = null;
    langRows().forEach(function (l) { if (l.key === key) hit = l; });
    return hit;
  };
  I18N.sourceLanguage = function () {
    return langRows().filter(function (l) { return l.is_source; })[0] || I18N.languageByKey(SOURCE_FALLBACK);
  };
  I18N.current = function () { return I18N.languageByKey(I18N.lang); };
  I18N.isSource = function () { return I18N.lang === I18N.source; };
  I18N.direction = function () { var l = I18N.current(); return (l && l.direction === 'rtl') ? 'rtl' : 'ltr'; };

  /** Rebuild the source-text -> phrase index and the active-language dictionary.
   *  Called at boot and after any catalogue write. */
  function reindex() {
    KNOWN = {};
    rows('phrase').forEach(function (p) { if (p.source != null) KNOWN[p.source] = p; });
    DICT = {}; DICT_CI = {};
    var lang = I18N.current();
    if (!lang || lang.is_source) return;
    var byId = {};
    rows('phrase').forEach(function (p) { byId[p.id] = p; });
    rows('translation').forEach(function (tr) {
      if (tr.language_id !== lang.id || !tr.text) return;
      var p = byId[tr.phrase_id];
      if (!p || p.source == null || !String(tr.text).trim()) return;
      // A machine translation of something carrying personal data is dropped on
      // sight (an older build could have recorded one). Reviewed wording is the
      // administrator's and is kept whatever it contains.
      if (tr.auto !== 0 && containsPrivate(p.source)) return;
      DICT[p.source] = String(tr.text);
    });
    Object.keys(DICT).forEach(function (k) {
      var lc = k.toLowerCase();
      if (DICT_CI[lc] == null) DICT_CI[lc] = DICT[k];
    });
  }
  I18N.reindex = function () { reindex(); };

  /** Text that is identity, not prose: it is never translated and never sent to
   *  a translation service.
   *    - people (names, usernames, emails) - privacy, and a person's name is not
   *      a word to be rendered differently per reader;
   *    - the languages themselves - a language picker has to offer "English" and
   *      "العربية" as they are written, whichever language the reader is in.
   *  Rebuilt whenever either list changes. */
  function rebuildNever() {
    NEVER = {};
    rows('user').forEach(function (u) {
      [u.name, u.username, u.email].forEach(function (v) { if (v) NEVER[String(v)] = 1; });
    });
    rows('language').forEach(function (l) {
      [l.name, l.native_name].forEach(function (v) { if (v) NEVER[String(v)] = 1; });
    });
    NEVER_RE = null;
    // A settlement name is a real place, pinned to real coordinates and searched
    // back by that name. It is never sent to a translation service - a service
    // translates words, and this is a name - but it IS written in the reader's
    // script by the transliterator above, and an administrator can override any
    // spelling in the Globalization panel.
    ADDRESSES = {};
    rows('partner').forEach(function (r) { if (r.address) ADDRESSES[String(r.address).trim()] = 1; });
    NO_AUTO = {}; PLACE_NAMES = {};
    rows('measurement').forEach(function (m) {
      if (!m.place_name) return;
      NO_AUTO[String(m.place_name)] = 1;        // never sent to a translation service
      PLACE_NAMES[String(m.place_name)] = 1;    // but transliterated on the way to the screen
    });
  }

  /** Does this string CONTAIN something that must never be translated?
   *
   *  An exact-match list is not enough, because the interface composes: an
   *  account tooltip is "<name> - account menu", a scope line is "<name> ·
   *  Countries". Sending that composite would send the person's name, and
   *  showing it back would render their name differently to every reader. So
   *  the whole set is compiled into one pattern and tested for containment. */
  var RE_SPECIAL = /[.*+?^${}()|[\]\\\/-]/g;
  function containsPrivate(s) {
    if (!NEVER_RE) {
      var parts = Object.keys(NEVER)
        .filter(function (k) { return k.length >= 3; })
        .sort(function (a, b) { return b.length - a.length; })
        .map(function (k) { return k.replace(RE_SPECIAL, function (c) { return '\\' + c; }); });
      // WHOLE WORDS ONLY. Plain containment matched a user called "Rima" inside
      // the word "Primary" and quietly took it out of the catalogue.
      NEVER_RE = parts.length
        ? new RegExp('(?:^|[^A-Za-z0-9])(?:' + parts.join('|') + ')(?![A-Za-z0-9])')
        : /(?!)/;
    }
    return NEVER_RE.test(s);
  }
  I18N.rebuildNever = rebuildNever;

  // ==========================================================================
  //  TRANSLITERATION - for names that have no translation, only a spelling
  //
  //  A settlement name is not a word to be translated; it is a sound to be
  //  written in the reader's script. "Nakuru" in Arabic is ناكورو - the same
  //  place, the same name, rendered so an Arabic reader can pronounce it. There
  //  are 3,773 of them in a portfolio this size and the distribution is flat, so
  //  a hand-written list is not the answer: the rules are.
  //
  //  This runs only for values the catalogue does not already answer, so an
  //  administrator who writes a better spelling in the Globalization panel wins,
  //  permanently. It is offline, deterministic, and costs one pass per name.
  // ==========================================================================
  var PLACE_NAMES = {};        // every settlement the database knows, for O(1) tests
  var ADDRESSES = {};          // postal addresses: never catalogued, never translated

  // Longest match first. Digraphs before single letters, so "sh" never becomes
  // س + ه. Arabic writes the long vowels; the short ones are left out, which is
  // how Arabic renders foreign names in practice.
  var AR_TRANSLIT = [
    ['sch', 'ش'], ['tch', 'تش'],
    ['ch', 'تش'], ['sh', 'ش'], ['th', 'ث'], ['kh', 'خ'], ['gh', 'غ'], ['ph', 'ف'],
    ['ck', 'ك'], ['qu', 'كو'], ['ng', 'نغ'], ['ny', 'ني'],
    ['aa', 'ا'], ['ou', 'و'], ['oo', 'و'], ['ee', 'ي'], ['ea', 'ي'], ['ie', 'ي'], ['ei', 'ي'],
    ['ai', 'اي'], ['ay', 'اي'], ['au', 'او'], ['aw', 'او'], ['oi', 'وي'], ['oy', 'وي'],
    ['a', 'ا'], ['b', 'ب'], ['c', 'ك'], ['d', 'د'], ['e', 'ي'], ['f', 'ف'],
    ['g', 'غ'], ['h', 'ه'], ['i', 'ي'], ['j', 'ج'], ['k', 'ك'], ['l', 'ل'],
    ['m', 'م'], ['n', 'ن'], ['o', 'و'], ['p', 'ب'], ['q', 'ق'], ['r', 'ر'],
    ['s', 'س'], ['t', 'ت'], ['u', 'و'], ['v', 'ف'], ['w', 'و'], ['x', 'كس'],
    ['y', 'ي'], ['z', 'ز'],
    ['á', 'ا'], ['à', 'ا'], ['â', 'ا'], ['ä', 'ا'], ['ã', 'ا'], ['å', 'ا'],
    ['é', 'ي'], ['è', 'ي'], ['ê', 'ي'], ['ë', 'ي'],
    ['í', 'ي'], ['ì', 'ي'], ['î', 'ي'], ['ï', 'ي'],
    ['ó', 'و'], ['ò', 'و'], ['ô', 'و'], ['ö', 'و'], ['õ', 'و'], ['ø', 'و'],
    ['ú', 'و'], ['ù', 'و'], ['û', 'و'], ['ü', 'و'],
    ['ç', 'س'], ['ñ', 'ني'], ['ß', 'س'], ['œ', 'و'], ['æ', 'ي'], ['ý', 'ي']
  ];

  /** One whitespace-delimited word, Latin script to Arabic script. */
  function arWord(word) {
    var lower = word.toLowerCase();
    if (!/[a-zÀ-ɏ]/.test(lower)) return word;      // digits, symbols: as they are
    var out = '', i = 0;
    // An initial vowel needs a carrier alif, or the name starts on a long vowel
    // that Arabic cannot begin a word with.
    var lead = /^[aeiouáàâäãåéèêëíìîïóòôöõøúùûü]/.test(lower);
    while (i < lower.length) {
      var hit = null;
      for (var r = 0; r < AR_TRANSLIT.length; r++) {
        var pair = AR_TRANSLIT[r];
        if (lower.substr(i, pair[0].length) === pair[0]) { hit = pair; break; }
      }
      if (!hit) { out += lower.charAt(i); i += 1; continue; }
      // a doubled consonant is written once
      if (out.slice(-hit[1].length) === hit[1] && !/[اوي]/.test(hit[1])) { i += hit[0].length; continue; }
      out += hit[1];
      i += hit[0].length;
    }
    // a two-letter particle ('es', 'al') takes no carrier hamza
    if (lead && out.charAt(0) !== 'ا' && lower.length > 2) out = 'أ' + out;
    return out;
  }

  /** Transliterate a whole name, keeping its separators and any non-Latin run. */
  function transliterateAr(text) {
    return String(text).split(/(\s+|[-'’])/).map(function (part) {
      if (!part || /^(\s+|[-'’])$/.test(part)) return part === "'" || part === '’' ? '' : part;
      return arWord(part);
    }).join('');
  }

  var TRANSLITERATORS = { ar: transliterateAr };

  /** The reader's spelling of a name the catalogue has no entry for. Returns
   *  null when this is not a name, or the active language has no transliterator. */
  function transliterate(text) {
    if (!PLACE_NAMES[text]) return null;
    var fn = TRANSLITERATORS[I18N.lang];
    return fn ? fn(text) : null;
  }
  I18N.transliterate = function (text, langKey) {
    var fn = TRANSLITERATORS[langKey || I18N.lang];
    return fn ? fn(text) : text;
  };

  // ==========================================================================
  //  Lookup
  // ==========================================================================
  /** The catalogue answer for one string: exact first, then case-insensitively,
   *  so a heading in Title Case and a sentence in lower case share one entry. */
  function look(s) {
    if (s == null || s === '' || NEVER[s]) return null;
    var hit = DICT[s];
    if (hit != null) return hit;
    hit = DICT_CI[String(s).toLowerCase()];
    return hit == null ? null : hit;
  }

  /** The catalogue answer for wording that arrives wrapped in ornament: a
   *  leading bullet, a count in front, a required-field asterisk behind.
   *
   *  splitCore cuts at the outermost letters, which also cuts a sentence's full
   *  stop away - and the catalogue holds sentences WITH their full stop. So the
   *  sentence keeps its tail on the first attempt and only loses it on the
   *  second, and a label like "Affiliation *" is answered either way. */
  function looseLook(str) {
    var p = splitCore(str);
    if (!p[1]) return null;
    if (p[0]) {
      var whole = look(p[1] + p[2]);
      if (whole != null) return p[0] + whole;
    }
    var bare = look(p[1]);
    if (bare != null) return p[0] + bare + p[2];
    if (p[2]) {
      var head = look(p[0] + p[1]);
      if (head != null) return head + p[2];
    }
    return null;
  }

  /** Substitute `to` for `from` inside `s`, once, with no regard for the "$&"
   *  family of replacement patterns - a translation is text, not a template. */
  function swap(s, from, to) { return s.replace(from, function () { return to; }); }

  /** Translate one segment of a composite line, keeping its own spacing. */
  var SEG_SPLIT = /(\s+[·|]\s+)/;      // " · " and " | ", separators kept
  function segment(seg) {
    var core = seg.trim();
    if (!core) return seg;
    var hit = look(core);
    if (hit != null) return swap(seg, core, hit);
    var tr = transliterate(core);
    if (tr != null) return swap(seg, core, tr);
    var loose = looseLook(core);
    if (loose != null) return swap(seg, core, loose);
    var p = splitCore(core);
    var tpl = templated(core);
    if (tpl != null) return swap(seg, core, tpl);
    if (!HAS_VALUE.test(core) && p[1] && !ELLIPSISED.test(core)) remember(p[1]);
    return seg;
  }

  /** A number or a month is a VALUE, not a word: "Even the best case lands at
   *  71% by Oct 2026" is the same sentence next month with different values in
   *  it. Lifting them out gives a key that is stable across every month, every
   *  percentage and every plan - one catalogue entry instead of hundreds, and
   *  one request to the translation service instead of a fresh one each time.
   *  The values are put back where the Arabic wants them, months translated. */
  // A numeric run never ends on a separator, so a sentence full stop is not
  // swallowed into the value; month names match on word boundaries only.
  var VALUE_RE = /(\d+(?:[.,]\d+)*%?|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\b)/g;
  var HAS_VALUE = /\d/;                 // cheap, and never a /g regex (lastIndex is stateful)
  var ELLIPSISED = /…\s*$/;             // the app cut this label to fit a column
  function templated(str) {
    var vals = [];
    var key = str.replace(VALUE_RE, function (m) { vals.push(m); return '{}'; });
    if (!vals.length || key === str) return null;
    // Nothing but values and punctuation - a date, a range, a count. There is no
    // wording to look up and none to learn, so the months are translated where
    // they stand and the rest is carried through: "1 Jan 2026 - 31 Dec 2030".
    if (!/[A-Za-z]/.test(key)) {
      var j = 0;
      return str.replace(VALUE_RE, function (m) {
        var mv = look(vals[j++]);
        return mv == null ? m : mv;
      });
    }
    var hit = look(key);
    // a template lifted out of a date is still one row's tooltip, not vocabulary
    if (hit == null) { if (!DATE_RE.test(str)) remember(key); return null; }
    var i = 0;
    return hit.replace(/\{\}/g, function () {
      var v = vals[i++];
      if (v == null) return '';
      var tv = look(v);                 // a month has a translation; a number does not
      return tv == null ? v : tv;
    });
  }

  /** Translate one string for the active language. Returns the source string
   *  unchanged when there is no translation (graceful, never blank).
   *
   *  Three attempts, cheapest first: the whole string; the string minus the
   *  digits and punctuation around it ("7 projects" -> "projects"); and, for a
   *  line the app assembled out of parts ("3,217 locations · 109 projects · …"),
   *  each part on its own. Whatever the catalogue cannot answer is left in
   *  English and queued to be learned. */
  I18N.t = function (s) {
    if (s == null || I18N.isSource()) return s;
    var raw = String(s);
    var trimmed = raw.trim();
    if (!trimmed) return raw;
    var lead = raw.slice(0, raw.indexOf(trimmed[0]));
    var tail = raw.slice(lead.length + trimmed.length);
    // A sentence written across several indented lines of HTML arrives with the
    // newlines and runs of spaces still in it. The browser collapses them when it
    // paints, so the catalogue is matched on the collapsed form - otherwise a
    // paragraph could only ever be found if it had been authored on one line.
    trimmed = trimmed.replace(/\s+/g, ' ');
    var hit = look(trimmed);
    if (hit != null) return lead + hit + tail;
    var parts = splitCore(trimmed);
    var loose = looseLook(trimmed);
    if (loose != null) return lead + loose + tail;
    if (SEG_SPLIT.test(trimmed)) {
      var pieces = trimmed.split(SEG_SPLIT), any = false;
      var out = pieces.map(function (piece, i) {
        if (i % 2) return piece;                 // the separator itself
        var t2 = segment(piece);
        if (t2 !== piece) any = true;
        return t2;
      }).join('');
      if (any) return lead + out + tail;
      return raw;                                // every part queued by segment()
    }
    if (ADDRESSES[trimmed]) return raw;          // a postal address is carried through as written
    var tr = transliterate(trimmed);             // a name, not a word: spell it
    if (tr != null) return lead + tr + tail;
    var tpl = templated(trimmed);
    if (tpl != null) return lead + tpl + tail;
    if (HAS_VALUE.test(trimmed)) return raw;     // templated() catalogued the key
    // A label the app had to shorten to fit is half a word. It is not
    // vocabulary and there is nothing useful to translate it into.
    if (ELLIPSISED.test(trimmed)) return raw;
    remember(parts[1] && translatable(parts[1]) ? parts[1] : trimmed);
    return raw;
  };
  var t = I18N.t;

  // ==========================================================================
  //  Queue - strings waiting for the background translation service
  // ==========================================================================
  /** Put a source string in the catalogue. `collect` (optional) receives the new
   *  rows instead of writing them one at a time, so a sweep of the whole database
   *  costs one write rather than thousands. */
  /** Remember a string the screen showed that the catalogue does not know.
   *
   *  This only CATALOGUES it, so an administrator can see and translate it; it
   *  does not ask a machine to. The distinction matters: a screen can surface
   *  hundreds of incidental strings a minute, and translating each one on sight
   *  meant a permanent trickle of network requests for wording nobody had asked
   *  for. Records the user actually writes are still translated automatically -
   *  see harvest().
   *
   *  Writes are buffered and flushed as ONE insert, rather than one write per
   *  string discovered. */
  var PENDING_NOTES = [], NOTE_TIMER = null;
  function remember(source) {
    if (!translatable(source) || KNOWN[source] || NOTED[source]) return;
    NOTED[source] = 1;
    PENDING_NOTES.push({ source: source, scope: 'ui', table_name: null, column_name: null, seq: null });
    if (NOTE_TIMER) return;
    NOTE_TIMER = setTimeout(flushNotes, 2000);
  }
  function flushNotes() {
    NOTE_TIMER = null;
    if (!PENDING_NOTES.length || !window.DB || !DB.tables.phrase) return;
    var batch = PENDING_NOTES; PENDING_NOTES = [];
    batch.forEach(function (r) { KNOWN[r.source] = r; });
    try { swallow(DB.insert('phrase', batch)); }
    catch (e) { batch.forEach(function (r) { delete KNOWN[r.source]; delete NOTED[r.source]; }); }
  }

  function note(source, scope, table, column, collect) {
    if (!translatable(source)) return;
    var p = KNOWN[source];
    if (p) {
      // upgrade a string first met in the interface to its real field
      if (scope === 'content' && p.scope !== 'content' && window.DB) {
        p.scope = 'content'; p.table_name = table || null; p.column_name = column || null;
        if (collect) collect.updates.push(p);
        else { try { swallow(DB.persist('phrase', [p])); } catch (e) {} }
      }
      return;
    }
    if (!window.DB || !DB.tables.phrase) return;
    var row = { source: source, scope: scope || 'ui', table_name: table || null, column_name: column || null, seq: null };
    KNOWN[source] = row;
    if (collect) { collect.inserts.push(row); return; }
    try { swallow(DB.insert('phrase', row)); } catch (e) { delete KNOWN[source]; }
  }
  I18N.note = note;

  function queue(source, force) {
    if ((!SETTINGS.auto && !force) || I18N.isSource()) return;
    if (!force && NO_AUTO[source]) return;
    if (!translatable(source) || QUEUED[source] || FAILED[source] || DICT[source] != null) return;
    if (PENDING.length >= QUEUE_LIMIT) return;
    note(source, 'ui');
    QUEUED[source] = 1;
    PENDING.push(source);
    I18N.stats.pending = PENDING.length;
    schedule();
  }
  I18N.queue = function (source, force) { queue(source, force); };

  var timer = null;
  function schedule(delay) {
    if (WORKING || timer) return;
    timer = setTimeout(function () { timer = null; drain(); }, delay == null ? BATCH_PAUSE : delay);
  }

  /** A free service will eventually say "enough". That is not a failure of the
   *  phrase - it is a request to come back later, so the batch goes back in the
   *  queue and the next attempt waits, doubling the wait each time it happens. */
  var COOLDOWN_UNTIL = 0, BACKOFF = 0;
  function coolDown() {
    BACKOFF = BACKOFF ? Math.min(BACKOFF * 2, 15 * 60000) : 30000;
    COOLDOWN_UNTIL = Date.now() + BACKOFF;
  }
  function requeue(src) {
    if (QUEUED[src] || PENDING.length >= QUEUE_LIMIT) return;
    QUEUED[src] = 1; PENDING.unshift(src);
  }

  function drain() {
    if (WORKING || !PENDING.length || I18N.isSource()) return;
    var lang = I18N.current();
    if (!lang) return;
    var wait = COOLDOWN_UNTIL - Date.now();
    if (wait > 0) { schedule(wait); return; }
    WORKING = true;
    var batch = PENDING.splice(0, BATCH_SIZE);
    batch.forEach(function (s) { delete QUEUED[s]; });
    I18N.stats.pending = PENDING.length;
    translateBatch(batch, I18N.source, lang.key).then(function (out) {
      var writes = [], held = Date.now() < COOLDOWN_UNTIL;
      batch.forEach(function (src, i) {
        var txt = out[i];
        // nothing came back AND the service asked us to wait: keep the phrase,
        // it has not been shown to be untranslatable
        if (!txt && held) { requeue(src); return; }
        if (!txt || txt === src) { FAILED[src] = 1; I18N.stats.failed++; return; }
        DICT[src] = txt;
        I18N.stats.done++;
        BACKOFF = 0;
        var p = KNOWN[src];
        if (p && p.id != null) writes.push({ phrase_id: p.id, language_id: lang.id, text: txt, auto: 1, updated: nowISO() });
      });
      I18N.stats.pending = PENDING.length;
      return storeTranslations(writes);
    }).catch(function () {
      batch.forEach(function (src) { FAILED[src] = 1; });
      I18N.stats.failed += batch.length;
    }).then(function () {
      WORKING = false;
      if (typeof I18N.onProgress === 'function') { try { I18N.onProgress(I18N.stats); } catch (e) {} }
      applyAll();
      if (PENDING.length) schedule();
    });
  }

  /** Upsert translation rows, never clobbering wording an administrator has
   *  reviewed (auto = 0). */
  function storeTranslations(list) {
    if (!list.length || !window.DB) return Promise.resolve();
    var existing = {};
    rows('translation').forEach(function (tr) { existing[tr.phrase_id + '|' + tr.language_id] = tr; });
    var inserts = [], updates = [];
    list.forEach(function (r) {
      var cur = existing[r.phrase_id + '|' + r.language_id];
      if (!cur) { inserts.push(r); return; }
      if (cur.auto === 0) return;                     // reviewed wording wins
      cur.text = r.text; cur.updated = r.updated; updates.push(cur);
    });
    var jobs = [];
    if (inserts.length) jobs.push(DB.insert('translation', inserts));
    if (updates.length) jobs.push(DB.persist('translation', updates));
    return Promise.all(jobs);
  }

  // ==========================================================================
  //  Translation services (free, no account needed)
  //
  //  Tried in order; the first that answers wins. An administrator can point
  //  the platform at a self-hosted LibreTranslate instead, in which case that
  //  endpoint is tried first and nothing leaves for a third party.
  // ==========================================================================
  function translateBatch(list, from, to) {
    var out = new Array(list.length);
    var i = 0;
    function step() {
      // the service asked us to wait: stop asking. Everything not yet attempted
      // stays undefined, which sends it back to the queue rather than burning it.
      if (i >= list.length || Date.now() < COOLDOWN_UNTIL) return Promise.resolve(out);
      var idx = i++;
      return translateOne(list[idx], from, to).then(function (txt) {
        out[idx] = txt;
        return step();
      });
    }
    return step();
  }

  function translateOne(text, from, to) {
    var providers = [];
    if (SETTINGS.endpoint) providers.push(libreTranslate);
    if (DB.mode === 'sqlite') providers.push(googleViaHost);
    providers.push(myMemory);
    var i = 0;
    function attempt() {
      if (i >= providers.length) return Promise.resolve(null);
      var fn = providers[i++];
      return fn(text, from, to).then(function (r) {
        return (r && String(r).trim()) ? String(r).trim() : attempt();
      }, function () { return attempt(); });
    }
    return attempt();
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timerId = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, ms || 12000);
      promise.then(function (v) { if (!done) { done = true; clearTimeout(timerId); resolve(v); } },
                   function (e) { if (!done) { done = true; clearTimeout(timerId); reject(e); } });
    });
  }

  /** MyMemory - a free, CORS-enabled translation memory. No key required.
   *
   *  It answers from a memory of human translations, so a near-miss can come
   *  back as somebody else's sentence entirely ("English" -> a reference number
   *  out of a filed document). It reports how good the match was, so anything
   *  below a confident match is treated as no answer at all. */
  var MEMORY_MIN_MATCH = 0.85;
  function myMemory(text, from, to) {
    var url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) +
              '&langpair=' + encodeURIComponent(from + '|' + to);
    return withTimeout(fetch(url).then(function (r) {
      if (r.status === 429) { coolDown(); throw new Error('rate limited'); }
      return r.json();
    }).then(function (b) {
      var d = b && b.responseData;
      var v = d && d.translatedText;
      if (!v || /^MYMEMORY WARNING/i.test(v) || /INVALID/i.test(v)) return null;
      var match = d.match == null ? 1 : +d.match;
      if (!(match >= MEMORY_MIN_MATCH)) return null;
      return v;
    }));
  }

  /** Google Translate, reached through the platform's own backend.
   *
   *  Google gives the best answer of the three, and it is the one the shipped
   *  catalogue was built with, so wording added later matches wording added
   *  earlier. It sends no CORS header, though, so a page cannot call it: the
   *  backend relays the request. An installation running on the browser store
   *  alone has nothing to relay through, and falls through to MyMemory. */
  function googleViaHost(text, from, to) {
    return withTimeout(fetch('api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: [text], from: from, to: to })
    }).then(function (r) {
      if (r.status === 429) { coolDown(); throw new Error('rate limited'); }
      return r.json();
    }).then(function (b) {
      return b && b.ok && b.text && b.text[0] ? b.text[0] : null;
    }));
  }

  /** Any LibreTranslate-compatible endpoint the administrator configures.
   *
   *  This is the one to set for a real deployment: it lifts the free service's
   *  daily ceiling, and nothing leaves for a third party. */
  function libreTranslate(text, from, to) {
    var body = { q: text, source: from, target: to, format: 'text' };
    if (SETTINGS.apiKey) body.api_key = SETTINGS.apiKey;
    return withTimeout(fetch(SETTINGS.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (b) {
      return b && b.translatedText ? b.translatedText : null;
    }));
  }

  // ==========================================================================
  //  DOM pass
  // ==========================================================================
  function skip(node) {
    var el = node.nodeType === 1 ? node : node.parentNode;
    while (el && el.nodeType === 1) {
      if (SKIP_TAGS[el.nodeName]) return true;
      if (el.getAttribute && el.getAttribute('data-notr') != null) return true;
      el = el.parentNode;
    }
    return false;
  }

  /** Rewrite one text node. The node remembers its English source, so a switch
   *  back to the source language restores it byte for byte. */
  /** Rewrite one text node.
   *
   *  Each node remembers BOTH the English it came from and the exact string we
   *  last wrote into it. That second half is what keeps the pass honest: when
   *  the value on the node is no longer the one we wrote, the app has re-rendered
   *  it, and the new English - not the remembered old English - is the source.
   *  Without it, a label that changes while a translation is showing (an account
   *  name, a live count, a status message) would be quietly reverted. */
  function doText(node) {
    var mine = node.__i18nOut != null && node.nodeValue === node.__i18nOut;
    var src = mine ? node.__i18nSrc : node.nodeValue;
    if (!src || !/[A-Za-z]/.test(src)) return;
    if (I18N.isSource()) {
      if (mine && node.nodeValue !== src) { node.nodeValue = src; node.__i18nOut = src; }
      return;
    }
    var out = t(src);
    if (out === src) { node.__i18nSrc = null; node.__i18nOut = null; return; }
    node.__i18nSrc = src; node.__i18nOut = out;
    if (node.nodeValue !== out) node.nodeValue = out;
  }

  /** The same rule for the attributes that carry prose. */
  function setAttrTranslated(get, set, store, key) {
    var cur = get();
    if (cur == null) return;
    var rec = store[key];
    var mine = rec && rec.out === cur;
    var src = mine ? rec.src : cur;
    if (!/[A-Za-z]/.test(src)) return;
    if (I18N.isSource()) {
      if (mine && cur !== src) { set(src); store[key] = null; }
      return;
    }
    var out = t(src);
    if (out === src) { store[key] = null; return; }
    store[key] = { src: src, out: out };
    if (cur !== out) set(out);
  }

  function isProse(el) {
    // `__i18nProse` keeps a block in the prose path after its markup has been
    // replaced by plain text - otherwise switching back to English would never
    // find it again to restore the emphasis.
    return el.nodeType === 1 && el.matches && el.matches(PROSE_SEL) &&
           (el.children.length > 0 || el.__i18nProse != null);
  }

  /** A prose block written as one sentence with its variable parts marked up -
   *  "Each row is one <b>Plan</b> ... for <b>August 2026</b>." - is read as a
   *  TEMPLATE: the marked-up parts become {} and the words between them become
   *  the catalogue key. The Arabic can then put the values wherever Arabic wants
   *  them, and the emphasis survives, because the original elements are put back
   *  rather than re-created. A note with no marked-up parts is just the sentence.
   */
  function proseTemplate(el) {
    var parts = [], vals = [];
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) parts.push(n.nodeValue);
      else if (n.nodeType === 1) { parts.push('{}'); vals.push(n); }
    }
    return { key: parts.join('').replace(/\s+/g, ' ').trim(), vals: vals };
  }

  /** Translate the text inside one of the values we are putting back. */
  function translateWithin(node) {
    if (node.nodeType === 3) { doText(node); return; }
    for (var i = 0; i < node.childNodes.length; i++) translateWithin(node.childNodes[i]);
  }

  function doProse(el) {
    var store = el.__i18nProse;
    var mine = store && el.innerHTML === store.out;
    var srcHTML = mine ? store.html : el.innerHTML;
    if (I18N.isSource()) {
      if (mine && el.innerHTML !== srcHTML) { el.innerHTML = srcHTML; el.__i18nProse = null; }
      return;
    }
    if (mine) return;                          // already showing our own translation

    var tpl = proseTemplate(el);
    if (!tpl.key || !/[A-Za-z]{3}/.test(tpl.key)) return;

    var hit = look(tpl.key);
    if (hit == null) {
      // a sentence with no variables in it can still be reached through the
      // ordinary lookups (core, segments, numeric template)
      if (!tpl.vals.length) {
        var plain = t(tpl.key);
        if (plain === tpl.key) return;
        el.textContent = plain;
        el.__i18nProse = { html: srcHTML, out: el.innerHTML };
        return;
      }
      remember(tpl.key);
      return;
    }

    var frag = document.createDocumentFragment();
    var pieces = String(hit).split('{}');
    for (var p = 0; p < pieces.length; p++) {
      if (pieces[p]) frag.appendChild(document.createTextNode(pieces[p]));
      if (p < tpl.vals.length) {
        var v = tpl.vals[p].cloneNode(true);
        translateWithin(v);                    // the value's own words, if any
        frag.appendChild(v);
      }
    }
    el.innerHTML = '';
    el.appendChild(frag);
    el.__i18nProse = { html: srcHTML, out: el.innerHTML };
  }

  // ==========================================================================
  //  Search
  //
  //  A reader searches for what is on their screen. If the interface is Arabic
  //  and the list says تغذية الطفل, typing that must find the record, even
  //  though the record itself is stored in English. So a search compares the
  //  query against the source AND its wording in the active language.
  //
  //  Arabic also needs folding before comparison: the same word is written with
  //  أ, إ, آ or ا, ends in ة or ه, and may carry vowel marks or a tatweel that
  //  the searcher will not reproduce. Folding those away is what makes typing a
  //  word find it.
  // ==========================================================================
  var AR_ALEF = /[آأإٱ]/g;      // آ أ إ ٱ  ->  ا
  var AR_MARKS = /[ً-ٰٟـ]/g;    // vowel marks and tatweel
  var AR_RANGE = /[؀-ۿ]/;
  // Arabic inflects around the stem: the definite article joins the front of a
  // word and gender, number and case are written on the end. A reader who types
  // الصحة is looking for records that say الصحية, so both sides of the
  // comparison are reduced to the stem before they meet.
  var AR_PREFIX = /^(?:وال|بال|فال|كال|لل|ال)/;
  var AR_SUFFIX = /(?:يه|ات|ين|ون|ها|هم|هن|ان|ه|ي|ا)$/;

  /** Normalise one string: case, alef forms, ta marbuta, vowel marks. */
  function normalise(text) {
    var v = (text == null ? '' : String(text)).toLowerCase();
    if (!AR_RANGE.test(v)) return v;
    return v.replace(AR_MARKS, '')
            .replace(AR_ALEF, 'ا')
            .replace(/ى/g, 'ي')             // ى -> ي
            .replace(/ة/g, 'ه');            // ة -> ه
  }

  /** One Arabic word reduced to its stem. Latin words are returned untouched. */
  function stemWord(w) {
    if (w.length < 3 || !AR_RANGE.test(w)) return w;
    var x = w.replace(AR_PREFIX, '');
    if (x.length >= 3) x = x.replace(AR_SUFFIX, '');
    return x.length >= 2 ? x : w;
  }

  function stemAll(text) {
    if (!AR_RANGE.test(text)) return text;
    return text.split(/(\s+)/).map(function (w) {
      return /^\s*$/.test(w) ? w : stemWord(w);
    }).join('');
  }

  /** A QUERY reduced to what it should be compared on. */
  I18N.fold = function (text) { return stemAll(normalise(text)); };

  /** A RECORD's searchable text: what it says, what the reader sees, and the
   *  stems of both, so an inflected query still finds it. */
  I18N.hay = function (text) {
    var v = text == null ? '' : String(text);
    if (!v) return '';
    var whole = I18N.isSource() ? v : (t(v) === v ? v : v + ' ' + t(v));
    var flat = normalise(whole), stemmed = stemAll(flat);
    return stemmed === flat ? flat : flat + ' ' + stemmed;
  };

  // ==========================================================================
  //  Form fields
  //
  //  A text box holds a record, and the record is stored in the source
  //  language. Handing the reader English in the one place they are asked to
  //  read most carefully, while every label around it is in their own language,
  //  is the wrong way round. Fields are therefore translated like anything else.
  //
  //  Writing back is where the care goes. A field the user did not touch must
  //  save the ORIGINAL wording, or opening a form in Arabic and pressing Save
  //  would quietly rewrite the record. A field the user DID edit while reading
  //  another language is an edit to THAT language: it is stored as the
  //  translation and the source is left as it was. Read a form with
  //  I18N.fieldValue(el), never with el.value.
  // ==========================================================================
  var FIELD_SEL = 'input[type="text"],input:not([type]),textarea';
  var FIELD_SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1 };

  /** TEXTAREA is in SKIP_TAGS because its child text must not be rewritten.
   *  Its VALUE still should be, so fields get their own ancestor test. */
  function skipField(el) {
    var n = el;
    while (n && n.nodeType === 1) {
      if (FIELD_SKIP[n.nodeName]) return true;
      if (n.getAttribute && n.getAttribute('data-notr') != null) return true;
      n = n.parentNode;
    }
    return false;
  }

  function doField(el) {
    // A disabled or read-only field is the one the reader can only READ, so it
    // matters most of all. Only the field under the cursor is left alone.
    if (!el || el === document.activeElement) return;
    var mine = el.__i18nOut != null && el.value === el.__i18nOut;
    var src = mine ? el.__i18nSrc : el.value;
    if (!src || !/[A-Za-z]/.test(src)) return;
    if (I18N.isSource()) {
      if (mine && el.value !== src) { el.value = src; el.__i18nOut = src; }
      return;
    }
    var out = t(src);
    if (out === el.value) return;
    el.value = out;
    el.__i18nSrc = src;
    el.__i18nOut = out;
  }

  /** The wording to store for one form field. */
  I18N.fieldValue = function (el) {
    if (!el) return '';
    var typed = el.value;
    if (el.__i18nOut == null) return typed;             // never carried a translation
    if (typed === el.__i18nOut) return el.__i18nSrc;    // untouched: the record keeps its wording
    if (!I18N.isSource() && el.__i18nSrc && typed.trim()) {
      I18N.write(el.__i18nSrc, typed.trim());           // an edit to this language
      return el.__i18nSrc;
    }
    return typed;
  };

  /** Store `text` as the active language's wording for `source`, marked
   *  reviewed so the background translator will never overwrite it. */
  I18N.write = function (source, text) {
    if (!window.DB || I18N.isSource() || !source || !text) return Promise.resolve();
    note(source, 'content');
    var phrase = KNOWN[source], lang = I18N.languageByKey(I18N.lang);
    if (!phrase || phrase.id == null || !lang) return Promise.resolve();
    var cur = null;
    rows('translation').forEach(function (r) {
      if (r.phrase_id === phrase.id && r.language_id === lang.id) cur = r;
    });
    var stamp = new Date().toISOString(), job;
    if (cur) {
      cur.text = text; cur.auto = 0; cur.updated = stamp;
      job = DB.persist('translation', [cur]);
    } else {
      job = DB.insert('translation', {
        phrase_id: phrase.id, language_id: lang.id, text: text, auto: 0, updated: stamp });
    }
    return Promise.resolve(job).then(function () { reindex(); });
  };

  function doAttrs(el) {
    if (!el.getAttribute) return;
    var store = el.__i18nAttr || (el.__i18nAttr = {});
    for (var i = 0; i < TEXT_ATTRS.length; i++) {
      (function (a) {
        setAttrTranslated(function () { return el.getAttribute(a); },
                          function (v) { el.setAttribute(a, v); }, store, a);
      })(TEXT_ATTRS[i]);
    }
    // button-like inputs carry their label in `value`
    if (el.nodeName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type || '')) {
      setAttrTranslated(function () { return el.value; },
                        function (v) { el.value = v; }, store, 'value');
    }
  }

  /** Translate a subtree in place. */
  function pass(root) {
    if (!root || (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11)) {
      if (root && root.nodeType === 3) { if (!skip(root)) doText(root); }
      return;
    }
    if (root.nodeType === 1 && skip(root)) return;
    SUSPEND++;
    try {
      if (root.nodeType === 1) doAttrs(root);
      // prose blocks first, whole; the walker then steps over them
      if (isProse(root)) { doProse(root); return; }
      if (root.querySelectorAll) {
        var blocks = root.querySelectorAll(PROSE_SEL);
        for (var b = 0; b < blocks.length; b++) if (isProse(blocks[b])) doProse(blocks[b]);
      }
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (n.nodeType === 1 && (SKIP_TAGS[n.nodeName] || (n.getAttribute && n.getAttribute('data-notr') != null)))
            return NodeFilter.FILTER_REJECT;
          if (n !== root && isProse(n)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var n;
      while ((n = walker.nextNode())) {
        if (n.nodeType === 3) doText(n);
        else doAttrs(n);
      }
      // Fields are swept separately: the walker steps over a textarea, and an
      // input's value is not a text node it would reach either.
      if (root.nodeType === 1 && root.matches && root.matches(FIELD_SEL) && !skipField(root)) doField(root);
      if (root.querySelectorAll) {
        var fields = root.querySelectorAll(FIELD_SEL);
        for (var q = 0; q < fields.length; q++) if (!skipField(fields[q])) doField(fields[q]);
      }
    } finally {
      SUSPEND--;
      if (OBSERVER && SUSPEND === 0) OBSERVER.takeRecords();   // discard our own writes
    }
  }
  I18N.translate = function (root) { if (I18N.ready) pass(root || document.body); };

  function applyAll() { if (I18N.ready) pass(document.body); }
  I18N.applyAll = applyAll;

  /** Collect the roots the observer reported and translate them together.
   *
   *  Deliberately a MICROTASK, not requestAnimationFrame: the pass has to land
   *  before the browser paints, and rAF does not run at all in a tab the browser
   *  is not drawing - which would leave a backgrounded window sitting in English
   *  until it came forward. A microtask always runs, and still beats paint. */
  function scheduleFor(node) {
    DIRTY.push(node);
    if (PASS_SCHEDULED) return;
    PASS_SCHEDULED = true;
    Promise.resolve().then(function () {
      PASS_SCHEDULED = false;
      var list = DIRTY; DIRTY = [];
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (n && (n.nodeType !== 1 || n.isConnected !== false)) pass(n);
      }
    });
  }

  function observe() {
    if (OBSERVER || typeof MutationObserver !== 'function') return;
    OBSERVER = new MutationObserver(function (records) {
      if (SUSPEND > 0 || I18N.isSource()) return;
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        if (rec.type === 'characterData') { scheduleFor(rec.target); continue; }
        if (rec.type === 'attributes') { scheduleFor(rec.target); continue; }
        for (var j = 0; j < rec.addedNodes.length; j++) scheduleFor(rec.addedNodes[j]);
      }
    });
    OBSERVER.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: TEXT_ATTRS
    });
  }

  // ==========================================================================
  //  Harvesting database text
  //
  //  DB.insert / DB.persist are wrapped once, so every record the app writes -
  //  from any panel, in either backend - offers its prose to the catalogue with
  //  no call site having to remember to.
  // ==========================================================================
  function harvest(table, list) {
    if (!table || SKIP_TABLES[table] || !list) return;
    var arr = Array.isArray(list) ? list : [list];
    for (var i = 0; i < arr.length; i++) {
      var row = arr[i]; if (!row) continue;
      for (var col in row) {
        if (!TEXT_COLUMNS[col] || !Object.prototype.hasOwnProperty.call(row, col)) continue;
        var v = row[col];
        if (typeof v !== 'string') continue;
        var s = v.trim();
        if (!translatable(s)) continue;
        note(s, 'content', table, col);
        if (!I18N.isSource() && DICT[s] == null) queue(s);
      }
    }
  }
  I18N.harvest = harvest;

  function wrapDB() {
    if (!window.DB || DB.__i18nWrapped) return;
    DB.__i18nWrapped = true;
    var insert = DB.insert, persist = DB.persist;
    DB.insert = function (table, list) {
      var out = insert.apply(DB, arguments);
      try { harvest(table, list); } catch (e) {}
      if (table === 'user' || table === 'language') { try { rebuildNever(); } catch (e) {} }
      return out;
    };
    DB.persist = function (table, list) {
      var out = persist.apply(DB, arguments);
      try { harvest(table, list); } catch (e) {}
      if (table === 'user' || table === 'language') { try { rebuildNever(); } catch (e) {} }
      return out;
    };
  }

  /** Every distinct translatable string held in the database right now.
   *  Feeds the panel's "translate the whole database" action and its counters. */
  I18N.contentStrings = function () {
    var seen = {}, out = [];
    var model = (window.DB && DB.model && DB.model.tables) || {};
    Object.keys(model).forEach(function (table) {
      if (SKIP_TABLES[table]) return;
      var cols = model[table].columns.filter(function (c) { return TEXT_COLUMNS[c]; });
      if (!cols.length) return;
      rows(table).forEach(function (r) {
        cols.forEach(function (c) {
          var v = r[c];
          if (typeof v !== 'string') return;
          var s = v.trim();
          if (!translatable(s) || seen[s]) return;
          seen[s] = 1;
          out.push({ source: s, table: table, column: c });
        });
      });
    });
    return out;
  };

  /** Catalogue every translatable string currently held in the database, in one
   *  write. Registering is deliberately separate from translating: a sweep can be
   *  thousands of strings, so what is SENT to a service is either what the screen
   *  actually needs or what an administrator explicitly asks for. */
  I18N.syncContent = function () {
    var list = I18N.contentStrings();
    var collect = { inserts: [], updates: [] };
    list.forEach(function (e) { note(e.source, 'content', e.table, e.column, collect); });
    if (collect.inserts.length) {
      try { swallow(DB.insert('phrase', collect.inserts)); }
      catch (e) { collect.inserts.forEach(function (r) { delete KNOWN[r.source]; }); }
    }
    if (collect.updates.length) { try { swallow(DB.persist('phrase', collect.updates)); } catch (e) {} }
    return { total: list.length, added: collect.inserts.length,
             missing: list.filter(function (e) { return DICT[e.source] == null; }).length };
  };

  // ==========================================================================
  //  Switching language
  // ==========================================================================
  function applyDirection() {
    var dir = I18N.direction();
    var html = document.documentElement;
    html.setAttribute('dir', dir);
    html.setAttribute('lang', I18N.lang);
    document.body.classList.toggle('rtl', dir === 'rtl');
  }

  I18N.setLang = function (key) {
    var lang = I18N.languageByKey(key);
    if (!lang || lang.enabled === 0) return false;
    I18N.lang = lang.key;
    setCookie(LANG_COOKIE, lang.key);
    try { localStorage.setItem(LANG_COOKIE, lang.key); } catch (e) {}
    reindex();
    applyDirection();
    if (typeof I18N.onChange === 'function') { try { I18N.onChange(lang); } catch (e) {} }
    // restore the source text everywhere first, then translate afresh
    pass(document.body);
    if (!I18N.isSource()) schedule();
    return true;
  };

  function storedLang() {
    var v = getCookie(LANG_COOKIE);
    if (!v) { try { v = localStorage.getItem(LANG_COOKIE); } catch (e) {} }
    return v || null;
  }

  // ==========================================================================
  //  Boot
  // ==========================================================================
  /** Bring the stored catalogue up to the shipped one.
   *
   *  This runs on EVERY start, not only on an empty database. A hosted install
   *  keeps its rows between releases, so "seed it if the table is empty" meant a
   *  platform that had ever been started could never receive a single new word
   *  again - which is exactly how an installation ends up with its interface
   *  translated and its data still in English.
   *
   *  The merge is additive and never destructive: missing languages and phrases
   *  are inserted, missing translations are inserted, and a translation that is
   *  present but BLANK is filled. Text that is already there is left alone,
   *  because it may be wording an administrator wrote.
   */
  I18N.reconcile = function () {
    var cat = window.CATALOG;
    if (!window.DB || !DB.tables.phrase || !cat || !cat.phrase) return Promise.resolve();

    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    var stats = { languages: 0, phrases: 0, translations: 0, filled: 0 };

    // ---- languages, matched on their code ---------------------------------
    var haveLang = {};
    rows('language').forEach(function (l) { haveLang[l.key] = l; });
    var newLangs = (cat.language || []).filter(function (l) { return !haveLang[l.key]; })
      .map(function (l) { var c = clone(l); delete c.id; return c; });
    stats.languages = newLangs.length;

    return Promise.resolve(newLangs.length ? DB.insert('language', newLangs) : null).then(function () {
      haveLang = {};
      rows('language').forEach(function (l) { haveLang[l.key] = l; });

      // ---- phrases, matched on the source string --------------------------
      var havePhrase = {};
      rows('phrase').forEach(function (p) { havePhrase[p.source] = p; });
      var newPhrases = cat.phrase.filter(function (p) { return !havePhrase[p.source]; })
        .map(function (p) {
          return { source: p.source, scope: p.scope, table_name: p.table_name,
                   column_name: p.column_name, seq: p.seq };
        });
      stats.phrases = newPhrases.length;
      return Promise.resolve(newPhrases.length ? DB.insert('phrase', newPhrases) : null);
    }).then(function () {
      var havePhrase = {};
      rows('phrase').forEach(function (p) { havePhrase[p.source] = p; });

      // the catalogue's own ids are local to the file - resolve them to ours
      var catPhrase = {}, catLang = {};
      cat.phrase.forEach(function (p) { catPhrase[p.id] = p.source; });
      (cat.language || []).forEach(function (l) { catLang[l.id] = l.key; });

      var haveTr = {};
      rows('translation').forEach(function (t) { haveTr[t.phrase_id + '|' + t.language_id] = t; });

      var inserts = [], updates = [];
      (cat.translation || []).forEach(function (ct) {
        var p = havePhrase[catPhrase[ct.phrase_id]];
        var l = haveLang[catLang[ct.language_id]];
        if (!p || !l || !ct.text) return;
        var cur = haveTr[p.id + '|' + l.id];
        if (!cur) {
          inserts.push({ phrase_id: p.id, language_id: l.id, text: ct.text, auto: 0, updated: null });
        } else if (!cur.text || !String(cur.text).trim()) {
          cur.text = ct.text; cur.auto = 0; updates.push(cur);   // fill a blank, never overwrite
        }
      });
      stats.translations = inserts.length;
      stats.filled = updates.length;

      // RETIRED FIELDS. An earlier release translated postal addresses. It should
      // not have: an address has to stay legible to the postal service that will
      // deliver to it. Any translation an earlier catalogue installed for one is
      // withdrawn here, so an upgraded installation stops showing it.
      var retired = [];
      rows('phrase').forEach(function (p) {
        if (RETIRED_COLUMNS[p.column_name]) {
          rows('translation').forEach(function (t) { if (t.phrase_id === p.id) retired.push(t.id); });
        }
      });

      var jobs = [];
      if (inserts.length) jobs.push(DB.insert('translation', inserts));
      if (updates.length) jobs.push(DB.persist('translation', updates));
      if (retired.length) { stats.retired = retired.length; jobs.push(DB.remove('translation', retired)); }
      return Promise.all(jobs);
    }).then(function () {
      if (stats.languages || stats.phrases || stats.translations || stats.filled || stats.retired) {
        console.info('i18n: catalogue updated -', stats.phrases, 'new phrases,',
                     stats.translations, 'new translations,', stats.filled, 'filled in,',
                     (stats.retired || 0), 'withdrawn.');
      }
      reindex();
      return stats;
    });
  };

  I18N.boot = function () {
    loadSettings();
    wrapDB();
    var src = I18N.sourceLanguage();
    I18N.source = src ? src.key : SOURCE_FALLBACK;
    var want = storedLang();
    var lang = (want && I18N.languageByKey(want)) || src;
    I18N.lang = lang ? lang.key : SOURCE_FALLBACK;
    rebuildNever();
    reindex();
    applyDirection();
    I18N.ready = true;
    observe();
    pass(document.body);
    if (!I18N.isSource()) schedule();
  };

  // Settings accessors for the Globalization panel
  I18N.settings = function () { return { auto: SETTINGS.auto, endpoint: SETTINGS.endpoint, apiKey: SETTINGS.apiKey }; };
  I18N.saveSettings = function (o) {
    if (typeof o.auto === 'boolean') SETTINGS.auto = o.auto;
    if (typeof o.endpoint === 'string') SETTINGS.endpoint = o.endpoint.trim();
    if (typeof o.apiKey === 'string') SETTINGS.apiKey = o.apiKey.trim();
    saveSettings();
    if (SETTINGS.auto) schedule();
  };
  I18N.queueLength = function () { return PENDING.length; };
  /** Machine-translate one string on demand (the panel's per-row ✨ button). */
  I18N.translateNow = function (text, langKey) {
    var lang = I18N.languageByKey(langKey);
    if (!lang) return Promise.resolve(null);
    return translateOne(text, I18N.source, lang.key);
  };
  /** Drain the queue immediately rather than waiting for the next tick. */
  I18N.flush = function () { drain(); };

  window.I18N = I18N;
})();
