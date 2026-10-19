/**
 * Image Crop – Admin2 integration.
 *
 * Loaded by Admin2 as an auto-loaded, button-less floating widget
 * (see onApiFloatingWidgets in image-crop.php). It:
 *   1. adds a crop icon to the image thumbnails of the media lists
 *      (page editor media panel, Media manager grid and list views);
 *   2. opens a crop editor (drag the corners / edges of the crop frame);
 *   3. saves through the plugin API: overwrite the image or create a copy.
 *
 * No build step: plain ES module, Admin2 globals only
 * (__GRAV_API, __GRAV_TOAST, __GRAV_I18N, __GRAV_PAGE_ROUTE, __GRAV_ADMIN_BASE).
 */

const WIDGET_TAG = window.__GRAV_WIDGET_TAG || 'grav-image-crop--widget';

// Admin2 waits for the widget custom element to be defined.
if (!customElements.get(WIDGET_TAG)) {
	customElements.define(WIDGET_TAG, class extends HTMLElement {});
}

/* ------------------------------------------------------------------------ */
/* Translations                                                              */
/* ------------------------------------------------------------------------ */

const STRINGS = {
	en: {
		crop: 'Crop image',
		title: 'Crop image',
		close: 'Close',
		loading: 'Loading image…',
		ratio: 'Aspect ratio',
		free: 'Free',
		original: 'Original',
		width: 'Width',
		height: 'Height',
		reset: 'Reset',
		size: 'Crop',
		originalSize: 'Original: {w} × {h} px',
		saveAs: 'Save',
		modeCopy: 'Save as a new image',
		modeOverwrite: 'Replace the original image',
		overwriteWarning: 'The original image will be permanently replaced.',
		copyName: 'File name',
		cancel: 'Cancel',
		saveCopy: 'Save copy',
		saveOverwrite: 'Replace image',
		saving: 'Saving…',
		savedCopy: 'Copy saved: {name}',
		savedOverwrite: 'Image cropped: {name} ({w} × {h} px)',
		errorLoad: 'The image could not be loaded.',
		errorResolve: 'This media file could not be found.',
		errorSave: 'The image could not be cropped.',
		unsupported_format: 'This file format cannot be cropped.',
		format_not_available: 'The server image library cannot write this format.',
		too_large: 'This image is too large to be cropped on this server.',
		animated_gif: 'Animated GIF images cannot be cropped (the animation would be lost).',
		hint: 'Drag the corners or edges of the frame, drag inside to move it, or draw a new frame on the image. Shift keeps the proportions, arrow keys move the frame.',
	},
	fr: {
		crop: "Recadrer l'image",
		title: "Recadrer l'image",
		close: 'Fermer',
		loading: "Chargement de l'image…",
		ratio: 'Proportions',
		free: 'Libre',
		original: 'Originales',
		width: 'Largeur',
		height: 'Hauteur',
		reset: 'Réinitialiser',
		size: 'Recadrage',
		originalSize: 'Original : {w} × {h} px',
		saveAs: 'Enregistrer',
		modeCopy: 'Enregistrer une nouvelle image',
		modeOverwrite: "Remplacer l'image d'origine",
		overwriteWarning: "L'image d'origine sera définitivement remplacée.",
		copyName: 'Nom du fichier',
		cancel: 'Annuler',
		saveCopy: 'Enregistrer la copie',
		saveOverwrite: "Remplacer l'image",
		saving: 'Enregistrement…',
		savedCopy: 'Copie enregistrée : {name}',
		savedOverwrite: 'Image recadrée : {name} ({w} × {h} px)',
		errorLoad: "L'image n'a pas pu être chargée.",
		errorResolve: 'Ce fichier est introuvable.',
		errorSave: "L'image n'a pas pu être recadrée.",
		unsupported_format: 'Ce format de fichier ne peut pas être recadré.',
		format_not_available: "La bibliothèque d'images du serveur ne sait pas écrire ce format.",
		too_large: 'Cette image est trop grande pour être recadrée sur ce serveur.',
		animated_gif: "Les GIF animés ne peuvent pas être recadrés (l'animation serait perdue).",
		hint: "Faites glisser les coins ou les bords du cadre, déplacez-le en le faisant glisser, ou tracez un nouveau cadre sur l'image. Maj conserve les proportions, les flèches du clavier déplacent le cadre.",
	},
};

function lang() {
	const locale = (window.__GRAV_I18N && window.__GRAV_I18N.locale) || document.documentElement.lang || navigator.language || 'en';
	const short = String(locale).toLowerCase().slice(0, 2);
	return STRINGS[short] ? short : 'en';
}

function t(key, params) {
	let s = (STRINGS[lang()] && STRINGS[lang()][key]) || STRINGS.en[key] || key;
	if (params) {
		for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
	}
	return s;
}

/* ------------------------------------------------------------------------ */
/* API helpers                                                               */
/* ------------------------------------------------------------------------ */

function apiPrefix() {
	return window.__GRAV_API_PREFIX || '/api/v1';
}

function apiUrl(path, params) {
	const server = (window.__GRAV_API_SERVER_URL || '').replace(/\/$/, '');
	const qs = params ? '?' + new URLSearchParams(params).toString() : '';
	return `${server}${apiPrefix()}${path}${qs}`;
}

async function apiGet(path, params) {
	if (window.__GRAV_API) return window.__GRAV_API.get(path, params);
	const res = await fetch(apiUrl(path, params), { headers: authHeaders(), credentials: 'include' });
	return unwrap(res);
}

async function apiPost(path, body) {
	if (window.__GRAV_API) return window.__GRAV_API.post(path, body);
	const res = await fetch(apiUrl(path), {
		method: 'POST',
		headers: { ...authHeaders(), 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify(body),
	});
	return unwrap(res);
}

function authHeaders() {
	const token = window.__GRAV_API_TOKEN;
	return token ? { 'X-API-Token': token } : {};
}

async function unwrap(res) {
	const json = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error(json.detail || json.title || res.statusText);
		err.status = res.status;
		throw err;
	}
	return json.data;
}

function errorMessage(err, fallback) {
	const msg = err && (err.message || err.detail);
	return msg && !/^HTTP \d+$/.test(msg) ? msg : fallback;
}

function toast(type, message) {
	const api = window.__GRAV_TOAST;
	if (api && typeof api[type] === 'function') api[type](message);
	else if (type === 'error') alert(message);
}

/* ------------------------------------------------------------------------ */
/* Crop icon injection in the media lists                                    */
/* ------------------------------------------------------------------------ */

const CROP_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>';

const GLOBAL_CSS = `
.gic-btn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: opacity .15s, background-color .15s, color .15s; }
.gic-btn:focus-visible { outline: 2px solid var(--ring, #3b82f6); outline-offset: 1px; }
.gic-tile-btn { width: 20px; height: 20px; border-radius: 3px; color: rgba(255,255,255,.8); }
.gic-tile-btn svg { width: 12px; height: 12px; }
.gic-tile-btn:hover { background: rgba(255,255,255,.2); color: #fff; }
.gic-card-btn { position: absolute; top: 6px; inset-inline-end: 6px; z-index: 2; width: 26px; height: 26px; border-radius: 6px; background: rgba(255,255,255,.92); color: #18181b; box-shadow: 0 1px 3px rgba(0,0,0,.35); opacity: 0; }
.group:hover .gic-card-btn, .gic-card-btn:focus-visible { opacity: 1; }
.gic-card-btn:hover { background: var(--primary, #2563eb); color: var(--primary-foreground, #fff); }
.gic-row-btn { flex-shrink: 0; width: 28px; height: 28px; border-radius: 6px; color: var(--muted-foreground, #71717a); opacity: 0; }
.group:hover .gic-row-btn, .gic-row-btn:focus-visible { opacity: 1; }
.gic-row-btn:hover { background: var(--accent, #f4f4f5); color: var(--foreground, #18181b); }
@media (hover: none) { .gic-card-btn, .gic-row-btn { opacity: 1; } }
`;

function init() {
	const style = document.createElement('style');
	style.id = 'image-crop-styles';
	style.textContent = GLOBAL_CSS;
	document.head.appendChild(style);

	let scheduled = false;
	const schedule = () => {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;
			scan();
		});
	};

	new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
	schedule();
}

/** Admin-internal route, e.g. "/media" or "/pages/edit/home". */
function adminRoute() {
	const base = window.__GRAV_ADMIN_BASE || '';
	let path = location.pathname;
	if (base && path.startsWith(base)) path = path.slice(base.length);
	return path || '/';
}

function isMediaManagerRoute() {
	return /^\/media(\/|$)/.test(adminRoute());
}

function thumbHash(src) {
	const m = /\/thumbnails\/([a-f0-9]{32})\.[a-z]+/i.exec(src || '');
	return m ? m[1] : null;
}

function makeButton(className) {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = `gic-btn ${className}`;
	btn.title = t('crop');
	btn.setAttribute('aria-label', t('crop'));
	btn.innerHTML = CROP_SVG;
	btn.setAttribute('draggable', 'false');
	// Keep the click (and drag) away from the tile / card underneath.
	for (const type of ['pointerdown', 'mousedown', 'dragstart']) {
		btn.addEventListener(type, (e) => e.stopPropagation());
	}
	return btn;
}

function scan() {
	const images = document.querySelectorAll('img[src*="/thumbnails/"]');
	for (const img of images) {
		if (!thumbHash(img.getAttribute('src'))) continue;

		// 1. Page editor: media panel tile (hover overlay with insert / info / delete buttons).
		const tile = img.closest('[data-reorder-tile]');
		if (tile) {
			if (!window.__GRAV_PAGE_ROUTE) continue; // flex-object media etc.: not supported
			const actions = tile.querySelector('.flex-shrink-0.items-center');
			if (!actions || actions.querySelector('.gic-btn')) continue;
			const btn = makeButton('gic-tile-btn');
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const route = String(window.__GRAV_PAGE_ROUTE || '').replace(/^\/+/, '');
				openEditor({ source: 'page', route, filename: img.getAttribute('alt') || '' }, img);
			});
			const last = actions.lastElementChild;
			// Before the delete button (always the last one when present).
			if (last && last.title && actions.children.length > 1) actions.insertBefore(btn, last);
			else actions.appendChild(btn);
			continue;
		}

		if (!isMediaManagerRoute()) continue;

		// 2. Media manager, grid view: square thumbnail of a file card.
		const thumbArea = img.parentElement;
		if (thumbArea && thumbArea.classList.contains('aspect-square') && img.alt) {
			if (thumbArea.querySelector('.gic-btn')) continue;
			const btn = makeButton('gic-card-btn');
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				openSiteMedia(img.getAttribute('alt') || '', img);
			});
			thumbArea.appendChild(btn);
			continue;
		}

		// 3. Media manager, list view: 40px thumbnail in a file row.
		const box = img.parentElement;
		const row = box && box.classList.contains('h-10') ? box.closest('.group') : null;
		if (row) {
			if (row.querySelector('.gic-btn')) continue;
			const nameEl = row.querySelector('.truncate.font-medium');
			const filename = nameEl ? nameEl.textContent.trim() : '';
			if (!filename) continue;
			const btn = makeButton('gic-row-btn');
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				openSiteMedia(filename, img);
			});
			row.appendChild(btn);
		}
	}
}

/**
 * Site media cards don't expose their folder: find the file with the API
 * search and match it by thumbnail hash (the same file name can exist in
 * several folders).
 */
async function openSiteMedia(filename, img) {
	if (!filename) return;
	const hash = thumbHash(img.getAttribute('src'));
	let path = null;
	try {
		const items = await apiGet('/media', { search: filename, per_page: '200' });
		const list = Array.isArray(items) ? items : (items && items.items) || [];
		const sameName = list.filter((it) => it.filename === filename);
		const exact = sameName.find((it) => thumbHash(it.thumbnail_url) === hash) || (sameName.length === 1 ? sameName[0] : null);
		if (exact) path = (exact.path ? exact.path.replace(/\/+$/, '') + '/' : '') + exact.filename;
	} catch (e) {
		// fall through to the root-folder guess
	}
	openEditor({ source: 'site', path: path || filename }, img);
}

/* ------------------------------------------------------------------------ */
/* Crop editor                                                               */
/* ------------------------------------------------------------------------ */

const RATIOS = [
	{ id: 'free', value: null },
	{ id: 'original', value: 'original' },
	{ id: '1:1', value: 1 },
	{ id: '4:3', value: 4 / 3 },
	{ id: '3:4', value: 3 / 4 },
	{ id: '3:2', value: 3 / 2 },
	{ id: '2:3', value: 2 / 3 },
	{ id: '16:9', value: 16 / 9 },
	{ id: '9:16', value: 9 / 16 },
];

const EDITOR_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.backdrop { position: fixed; inset: 0; z-index: 2147483000; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; padding: 16px; font-family: inherit; font-size: 14px; color: var(--foreground, #18181b); animation: fade .15s ease-out; }
@keyframes fade { from { opacity: 0; } }
.dialog { width: min(1100px, 100%); max-height: calc(100vh - 32px); display: flex; flex-direction: column; background: var(--popover, var(--background, #fff)); color: var(--popover-foreground, var(--foreground, #18181b)); border: 1px solid var(--border, #e4e4e7); border-radius: calc(var(--radius, .5rem) + 4px); box-shadow: 0 25px 50px -12px rgba(0,0,0,.45); overflow: hidden; }
header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border, #e4e4e7); }
header h2 { margin: 0; font-size: 15px; font-weight: 600; }
header .file { flex: 1; min-width: 0; color: var(--muted-foreground, #71717a); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
button { font: inherit; }
.icon-btn { all: unset; display: inline-flex; width: 30px; height: 30px; align-items: center; justify-content: center; border-radius: 6px; cursor: pointer; color: var(--muted-foreground, #71717a); }
.icon-btn:hover { background: var(--accent, #f4f4f5); color: var(--foreground, #18181b); }
.icon-btn:focus-visible, .btn:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--ring, #3b82f6); outline-offset: 1px; }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 10px 16px; border-bottom: 1px solid var(--border, #e4e4e7); font-size: 13px; }
.toolbar label { display: inline-flex; align-items: center; gap: 6px; color: var(--muted-foreground, #71717a); }
select, input[type=number], input[type=text] { font: inherit; font-size: 13px; color: var(--foreground, #18181b); background: var(--background, #fff); border: 1px solid var(--border, #e4e4e7); border-radius: 6px; padding: 5px 8px; height: 30px; }
input[type=number] { width: 84px; }
.sep { color: var(--muted-foreground, #71717a); }
.spacer { flex: 1; }
.info { color: var(--muted-foreground, #71717a); font-variant-numeric: tabular-nums; }
.stage { position: relative; flex: 1; min-height: 240px; height: min(62vh, 640px); display: flex; align-items: center; justify-content: center; padding: 20px; background-color: var(--muted, #f4f4f5); background-image: linear-gradient(45deg, rgba(127,127,127,.12) 25%, transparent 25%), linear-gradient(-45deg, rgba(127,127,127,.12) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(127,127,127,.12) 75%), linear-gradient(-45deg, transparent 75%, rgba(127,127,127,.12) 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0; overflow: hidden; }
.message { color: var(--muted-foreground, #71717a); text-align: center; max-width: 420px; line-height: 1.5; }
.message.error { color: var(--destructive, #dc2626); }
.canvas { position: relative; touch-action: none; user-select: none; -webkit-user-select: none; cursor: crosshair; flex: none; }
.canvas img { display: block; width: 100%; height: 100%; pointer-events: none; }
.box { position: absolute; cursor: move; outline: 1px solid rgba(255,255,255,.95); box-shadow: 0 0 0 1px rgba(0,0,0,.45), 0 0 0 9999px rgba(0,0,0,.55); }
.box:focus-visible { outline: 2px solid var(--ring, #3b82f6); }
.grid { position: absolute; inset: 0; pointer-events: none; opacity: .55; background-image: linear-gradient(to right, transparent calc(33.333% - .5px), rgba(255,255,255,.9) calc(33.333% - .5px), rgba(255,255,255,.9) calc(33.333% + .5px), transparent calc(33.333% + .5px), transparent calc(66.666% - .5px), rgba(255,255,255,.9) calc(66.666% - .5px), rgba(255,255,255,.9) calc(66.666% + .5px), transparent calc(66.666% + .5px)), linear-gradient(to bottom, transparent calc(33.333% - .5px), rgba(255,255,255,.9) calc(33.333% - .5px), rgba(255,255,255,.9) calc(33.333% + .5px), transparent calc(33.333% + .5px), transparent calc(66.666% - .5px), rgba(255,255,255,.9) calc(66.666% - .5px), rgba(255,255,255,.9) calc(66.666% + .5px), transparent calc(66.666% + .5px)); }
.h { position: absolute; width: 14px; height: 14px; background: #fff; border: 1px solid rgba(0,0,0,.55); border-radius: 3px; box-shadow: 0 1px 3px rgba(0,0,0,.4); }
.h::after { content: ''; position: absolute; inset: -8px; }
.h[data-h=nw] { left: -7px; top: -7px; cursor: nwse-resize; }
.h[data-h=ne] { right: -7px; top: -7px; cursor: nesw-resize; }
.h[data-h=sw] { left: -7px; bottom: -7px; cursor: nesw-resize; }
.h[data-h=se] { right: -7px; bottom: -7px; cursor: nwse-resize; }
.h[data-h=n] { left: calc(50% - 10px); top: -5px; width: 20px; height: 10px; cursor: ns-resize; }
.h[data-h=s] { left: calc(50% - 10px); bottom: -5px; width: 20px; height: 10px; cursor: ns-resize; }
.h[data-h=w] { top: calc(50% - 10px); left: -5px; width: 10px; height: 20px; cursor: ew-resize; }
.h[data-h=e] { top: calc(50% - 10px); right: -5px; width: 10px; height: 20px; cursor: ew-resize; }
.badge { position: absolute; left: 50%; bottom: 6px; transform: translateX(-50%); padding: 2px 7px; border-radius: 4px; background: rgba(0,0,0,.65); color: #fff; font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none; }
.hint { padding: 8px 16px 0; color: var(--muted-foreground, #71717a); font-size: 12px; line-height: 1.45; }
footer { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 20px; padding: 12px 16px 14px; }
fieldset { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; flex: 1 1 360px; }
legend { padding: 0; margin-bottom: 6px; font-size: 12px; font-weight: 600; color: var(--muted-foreground, #71717a); text-transform: uppercase; letter-spacing: .03em; }
.radio { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.radio input { margin: 0; accent-color: var(--primary, #2563eb); }
.name-row { display: flex; align-items: center; gap: 6px; padding-inline-start: 24px; }
.name-row input { flex: 1; min-width: 0; }
.name-row .ext { color: var(--muted-foreground, #71717a); }
.warning { padding-inline-start: 24px; color: var(--destructive, #dc2626); font-size: 12px; }
.actions { display: flex; gap: 8px; margin-inline-start: auto; }
.btn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 34px; padding: 0 14px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--border, #e4e4e7); background: var(--background, #fff); color: var(--foreground, #18181b); white-space: nowrap; }
.btn:hover { background: var(--accent, #f4f4f5); }
.btn.primary { background: var(--primary, #2563eb); border-color: var(--primary, #2563eb); color: var(--primary-foreground, #fff); }
.btn.primary:hover { filter: brightness(1.08); }
.btn.danger { background: var(--destructive-solid, var(--destructive, #dc2626)); border-color: transparent; color: #fff; }
.btn.danger:hover { filter: brightness(1.08); }
.btn[disabled] { opacity: .55; pointer-events: none; }
.hidden { display: none !important; }
@media (max-width: 640px) { .stage { height: 52vh; padding: 12px; } .hint { display: none; } }
`;

let currentEditor = null;

async function openEditor(target, sourceImg) {
	if (currentEditor) currentEditor.close();
	const editor = new CropEditor(target, sourceImg);
	currentEditor = editor;
	editor.open();
}

class CropEditor {
	constructor(target, sourceImg) {
		this.target = target;
		this.sourceImg = sourceImg;
		this.info = null;
		this.nat = { w: 0, h: 0 };
		this.rect = { x: 0, y: 0, w: 0, h: 0 };
		this.ratio = null;
		this.scale = 1;
		this.drag = null;
		this.saving = false;
		this.nameEdited = false;
		this.objectUrl = null;
		this.onKey = this.onKey.bind(this);
		this.onResize = this.onResize.bind(this);
	}

	/* ---------- lifecycle ---------- */

	open() {
		this.host = document.createElement('div');
		this.host.setAttribute('data-image-crop-editor', '');
		this.root = this.host.attachShadow({ mode: 'open' });
		this.root.innerHTML = `<style>${EDITOR_CSS}</style>${this.template()}`;
		document.body.appendChild(this.host);

		this.$ = (sel) => this.root.querySelector(sel);
		// Use the admin font (the shadow root starts from `all: initial`).
		this.$('.backdrop').style.fontFamily = getComputedStyle(document.body).fontFamily;
		this.lastFocus = document.activeElement;

		this.$('.backdrop').addEventListener('pointerdown', (e) => {
			if (e.target === e.currentTarget && !this.saving) this.close();
		});
		this.$('[data-close]').addEventListener('click', () => this.close());
		this.$('[data-cancel]').addEventListener('click', () => this.close());
		this.$('[data-save]').addEventListener('click', () => this.save());
		this.$('[data-reset]').addEventListener('click', () => this.reset());
		this.$('[data-ratio]').addEventListener('change', (e) => this.setRatio(e.target.value));
		this.$('[data-w]').addEventListener('change', (e) => this.setSize('w', e.target.value));
		this.$('[data-h]').addEventListener('change', (e) => this.setSize('h', e.target.value));
		for (const r of this.root.querySelectorAll('input[name=mode]')) {
			r.addEventListener('change', () => this.updateMode());
		}
		this.$('[data-name]').addEventListener('input', () => { this.nameEdited = true; });

		document.addEventListener('keydown', this.onKey, true);
		window.addEventListener('resize', this.onResize);
		this.$('[data-close]').focus();

		this.load();
	}

	close() {
		document.removeEventListener('keydown', this.onKey, true);
		window.removeEventListener('resize', this.onResize);
		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.host?.remove();
		if (currentEditor === this) currentEditor = null;
		if (this.lastFocus && typeof this.lastFocus.focus === 'function' && document.contains(this.lastFocus)) {
			this.lastFocus.focus();
		}
	}

	template() {
		const name = this.target.filename || (this.target.path || '').split('/').pop() || '';
		const options = RATIOS.map((r) => `<option value="${r.id}">${r.id === 'free' ? t('free') : r.id === 'original' ? t('original') : r.id}</option>`).join('');
		return `
<div class="backdrop">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="gic-title">
    <header>
      <h2 id="gic-title">${esc(t('title'))}</h2>
      <div class="file" title="${esc(name)}">${esc(name)}</div>
      <button class="icon-btn" type="button" data-close title="${esc(t('close'))}" aria-label="${esc(t('close'))}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </header>
    <div class="toolbar" data-toolbar>
      <label>${esc(t('ratio'))} <select data-ratio>${options}</select></label>
      <label>${esc(t('width'))} <input type="number" min="1" step="1" data-w></label>
      <span class="sep">×</span>
      <label>${esc(t('height'))} <input type="number" min="1" step="1" data-h></label>
      <span class="info">px</span>
      <button class="btn" type="button" data-reset>${esc(t('reset'))}</button>
      <span class="spacer"></span>
      <span class="info" data-original></span>
    </div>
    <div class="stage" data-stage>
      <div class="message" data-message>${esc(t('loading'))}</div>
      <div class="canvas hidden" data-canvas>
        <img alt="" data-img draggable="false">
        <div class="box" data-box tabindex="0" role="group" aria-label="${esc(t('size'))}">
          <div class="grid"></div>
          ${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<div class="h" data-h="${h}"></div>`).join('')}
          <div class="badge" data-badge></div>
        </div>
      </div>
    </div>
    <div class="hint">${esc(t('hint'))}</div>
    <footer>
      <fieldset>
        <legend>${esc(t('saveAs'))}</legend>
        <label class="radio"><input type="radio" name="mode" value="copy" checked> ${esc(t('modeCopy'))}</label>
        <div class="name-row" data-name-row>
          <input type="text" data-name aria-label="${esc(t('copyName'))}" spellcheck="false" autocomplete="off">
          <span class="ext" data-ext></span>
        </div>
        <label class="radio"><input type="radio" name="mode" value="overwrite"> ${esc(t('modeOverwrite'))}</label>
        <div class="warning hidden" data-warning>${esc(t('overwriteWarning'))}</div>
      </fieldset>
      <div class="actions">
        <button class="btn" type="button" data-cancel>${esc(t('cancel'))}</button>
        <button class="btn primary" type="button" data-save disabled>${esc(t('saveCopy'))}</button>
      </div>
    </footer>
  </div>
</div>`;
	}

	async load() {
		try {
			this.info = await apiGet('/image-crop/info', this.targetParams());
		} catch (err) {
			return this.fail(err && err.status === 404 ? t('errorResolve') : errorMessage(err, t('errorLoad')));
		}

		const info = this.info;
		this.target = { ...this.target, source: info.source, route: info.route, path: info.path, filename: info.filename };
		this.$('.file').textContent = info.filename;
		this.$('.file').title = info.path || info.filename;
		this.$('[data-ext]').textContent = info.extension ? `.${info.extension}` : '';
		this.$('[data-original]').textContent = t('originalSize', { w: info.width, h: info.height });

		if (!info.supported) return this.fail(t(info.reason || 'unsupported_format'));

		try {
			const res = await fetch(apiUrl('/image-crop/image', this.targetParams()), {
				headers: authHeaders(),
				credentials: 'include',
				cache: 'no-store',
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			this.objectUrl = URL.createObjectURL(await res.blob());
		} catch (err) {
			return this.fail(t('errorLoad'));
		}

		const img = this.$('[data-img]');
		img.onload = () => {
			// The browser applies the EXIF orientation: natural size = displayed size.
			this.nat = { w: img.naturalWidth || info.width, h: img.naturalHeight || info.height };
			this.$('[data-message]').classList.add('hidden');
			this.$('[data-canvas]').classList.remove('hidden');
			this.$('[data-save]').disabled = false;
			this.reset();
			this.bindPointer();
			this.$('[data-box]').focus();
		};
		img.onerror = () => this.fail(t('errorLoad'));
		img.src = this.objectUrl;
	}

	fail(message) {
		const msg = this.$('[data-message]');
		msg.textContent = message;
		msg.classList.add('error');
		msg.classList.remove('hidden');
		this.$('[data-canvas]').classList.add('hidden');
		this.$('[data-save]').disabled = true;
	}

	targetParams() {
		const tg = this.target;
		return tg.source === 'page'
			? { source: 'page', route: tg.route || '', filename: tg.filename || '' }
			: { source: 'site', path: tg.path || '' };
	}

	/* ---------- geometry ---------- */

	layout() {
		const stage = this.$('[data-stage]');
		const cs = getComputedStyle(stage);
		const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
		const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
		this.scale = Math.min(availW / this.nat.w, availH / this.nat.h, 1) || 1;
		const canvas = this.$('[data-canvas]');
		canvas.style.width = `${Math.round(this.nat.w * this.scale)}px`;
		canvas.style.height = `${Math.round(this.nat.h * this.scale)}px`;
		this.render();
	}

	onResize() {
		if (this.nat.w) this.layout();
	}

	reset() {
		this.$('[data-ratio]').value = 'free';
		this.ratio = null;
		this.rect = { x: 0, y: 0, w: this.nat.w, h: this.nat.h };
		this.layout();
	}

	ratioValue(id) {
		const r = RATIOS.find((x) => x.id === id);
		if (!r || r.value === null) return null;
		return r.value === 'original' ? this.nat.w / this.nat.h : r.value;
	}

	setRatio(id) {
		this.ratio = this.ratioValue(id);
		if (!this.ratio) return this.render();
		// Largest frame with this ratio, centered on the current frame, inside the image.
		const cx = this.rect.x + this.rect.w / 2;
		const cy = this.rect.y + this.rect.h / 2;
		let w = this.nat.w;
		let h = w / this.ratio;
		if (h > this.nat.h) {
			h = this.nat.h;
			w = h * this.ratio;
		}
		this.rect = this.clampMove({ x: cx - w / 2, y: cy - h / 2, w, h });
		this.render();
	}

	setSize(dim, raw) {
		let v = Math.round(Number(raw));
		if (!Number.isFinite(v) || v < 1) return this.render();
		const r = this.rect;
		const cx = r.x + r.w / 2;
		const cy = r.y + r.h / 2;
		let w = r.w;
		let h = r.h;
		if (dim === 'w') {
			w = Math.min(v, this.nat.w);
			if (this.ratio) h = w / this.ratio;
		} else {
			h = Math.min(v, this.nat.h);
			if (this.ratio) w = h * this.ratio;
		}
		if (this.ratio && (w > this.nat.w || h > this.nat.h)) {
			const k = Math.min(this.nat.w / w, this.nat.h / h);
			w *= k;
			h *= k;
		}
		this.rect = this.clampMove({ x: cx - w / 2, y: cy - h / 2, w, h });
		this.render();
	}

	clampMove(r) {
		const w = Math.min(Math.max(r.w, 1), this.nat.w);
		const h = Math.min(Math.max(r.h, 1), this.nat.h);
		return {
			x: Math.min(Math.max(r.x, 0), this.nat.w - w),
			y: Math.min(Math.max(r.y, 0), this.nat.h - h),
			w,
			h,
		};
	}

	minSize() {
		// At least 1 image pixel, and a frame that stays grabbable on screen.
		return Math.max(1, 12 / this.scale);
	}

	/**
	 * Frame between a fixed anchor point and the pointer (corner drag / new frame).
	 * With a ratio, `driver` says which axis sets the size: 'w', 'h', or
	 * 'cover' (the larger extent, used when drawing a new frame).
	 */
	fromAnchor(ax, ay, px, py, ratio, driver = 'cover') {
		const min = this.minSize();
		const dirX = px < ax ? -1 : 1;
		const dirY = py < ay ? -1 : 1;
		const maxW = dirX < 0 ? ax : this.nat.w - ax;
		const maxH = dirY < 0 ? ay : this.nat.h - ay;
		let w = Math.min(Math.abs(px - ax), maxW);
		let h = Math.min(Math.abs(py - ay), maxH);

		if (ratio) {
			// Follow the pointer along the driving axis, then fit in the image.
			const byWidth = driver === 'w' || (driver === 'cover' && w / ratio >= h);
			if (byWidth) h = w / ratio;
			else w = h * ratio;
			const k = Math.min(1, maxW / w || 1, maxH / h || 1);
			w *= k;
			h *= k;
			if (w < min || h < min) {
				const m = Math.max(min / w || 1, min / h || 1);
				w = Math.min(w * m, maxW);
				h = w / ratio;
			}
		} else {
			w = Math.max(w, Math.min(min, maxW));
			h = Math.max(h, Math.min(min, maxH));
		}

		return { x: dirX < 0 ? ax - w : ax, y: dirY < 0 ? ay - h : ay, w, h };
	}

	resizeFrom(handle, s, dx, dy, ratio) {
		const min = this.minSize();
		const hasW = handle.includes('w');
		const hasE = handle.includes('e');
		const hasN = handle.includes('n');
		const hasS = handle.includes('s');

		// Corners: opposite corner stays fixed.
		if ((hasW || hasE) && (hasN || hasS)) {
			const ax = hasW ? s.x + s.w : s.x;
			const ay = hasN ? s.y + s.h : s.y;
			const px = (hasW ? s.x : s.x + s.w) + dx;
			const py = (hasN ? s.y : s.y + s.h) + dy;
			// Never let a corner cross over the anchor: keep the direction of the handle.
			const cx = hasW ? Math.min(px, ax - min) : Math.max(px, ax + min);
			const cy = hasN ? Math.min(py, ay - min) : Math.max(py, ay + min);
			// With a ratio, the axis the pointer moved most along drives the size.
			const driver = ratio ? (Math.abs(dx) >= Math.abs(dy) * ratio ? 'w' : 'h') : 'cover';
			return this.fromAnchor(ax, ay, cx, cy, ratio, driver);
		}

		// Edges.
		if (hasW || hasE) {
			let x1 = s.x;
			let x2 = s.x + s.w;
			if (hasW) x1 = Math.min(Math.max(0, s.x + dx), x2 - min);
			else x2 = Math.max(Math.min(this.nat.w, x2 + dx), x1 + min);
			let w = x2 - x1;
			if (!ratio) return { x: x1, y: s.y, w, h: s.h };
			const cy = s.y + s.h / 2;
			const maxH = 2 * Math.min(cy, this.nat.h - cy);
			w = Math.min(w, maxH * ratio);
			const h = w / ratio;
			return { x: hasW ? x2 - w : x1, y: cy - h / 2, w, h };
		}

		let y1 = s.y;
		let y2 = s.y + s.h;
		if (hasN) y1 = Math.min(Math.max(0, s.y + dy), y2 - min);
		else y2 = Math.max(Math.min(this.nat.h, y2 + dy), y1 + min);
		let h = y2 - y1;
		if (!ratio) return { x: s.x, y: y1, w: s.w, h };
		const cx = s.x + s.w / 2;
		const maxW = 2 * Math.min(cx, this.nat.w - cx);
		h = Math.min(h, maxW / ratio);
		const w = h * ratio;
		return { x: cx - w / 2, y: hasN ? y2 - h : y1, w, h };
	}

	/** Pointer position in image pixels. */
	toImage(e) {
		const box = this.$('[data-canvas]').getBoundingClientRect();
		return {
			x: Math.min(Math.max((e.clientX - box.left) / this.scale, 0), this.nat.w),
			y: Math.min(Math.max((e.clientY - box.top) / this.scale, 0), this.nat.h),
		};
	}

	bindPointer() {
		const canvas = this.$('[data-canvas]');

		canvas.addEventListener('pointerdown', (e) => {
			if (e.button !== 0 || this.saving) return;
			e.preventDefault();
			const handle = e.target.closest('[data-h]');
			const inBox = e.target.closest('[data-box]');
			const p = this.toImage(e);
			this.drag = {
				mode: handle ? 'resize' : inBox ? 'move' : 'draw',
				handle: handle ? handle.dataset.h : null,
				start: { ...this.rect },
				p0: p,
				pointerId: e.pointerId,
			};
			try {
				canvas.setPointerCapture(e.pointerId);
			} catch (err) {
				// Pointer already released (very fast click): nothing to capture.
			}
			this.$('[data-box]').focus({ preventScroll: true });
		});

		canvas.addEventListener('pointermove', (e) => {
			const d = this.drag;
			if (!d || e.pointerId !== d.pointerId) return;
			const p = this.toImage(e);
			const dx = p.x - d.p0.x;
			const dy = p.y - d.p0.y;
			// Shift locks the proportions of the frame when no ratio is selected.
			const ratio = this.ratio || (e.shiftKey && d.mode !== 'move' ? (d.mode === 'draw' ? 1 : d.start.w / d.start.h) : null);

			if (d.mode === 'move') {
				this.rect = this.clampMove({ ...d.start, x: d.start.x + dx, y: d.start.y + dy });
			} else if (d.mode === 'resize') {
				this.rect = this.resizeFrom(d.handle, d.start, dx, dy, ratio);
			} else if (Math.abs(dx) * this.scale > 3 || Math.abs(dy) * this.scale > 3) {
				this.rect = this.fromAnchor(d.p0.x, d.p0.y, p.x, p.y, ratio);
			}
			this.render();
		});

		const end = (e) => {
			if (!this.drag || e.pointerId !== this.drag.pointerId) return;
			this.drag = null;
			this.rect = this.clampMove(this.rect);
			this.render();
		};
		canvas.addEventListener('pointerup', end);
		canvas.addEventListener('pointercancel', end);
	}

	onKey(e) {
		if (!this.host || !this.host.isConnected) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			if (!this.saving) this.close();
			return;
		}
		const active = this.root.activeElement;
		if (e.key === 'Enter' && active && active.matches && active.matches('[data-box], [data-name]')) {
			e.preventDefault();
			e.stopPropagation();
			this.save();
			return;
		}
		if (!active || !active.matches || !active.matches('[data-box]') || !this.nat.w) return;
		const step = e.shiftKey ? 10 : 1;
		const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
		if (!moves[e.key]) return;
		e.preventDefault();
		e.stopPropagation();
		const [mx, my] = moves[e.key];
		if (e.altKey) {
			// Alt + arrows resize the frame from its bottom-right corner.
			this.rect = this.resizeFrom(mx ? 'e' : 's', this.rect, mx, my, this.ratio);
		} else {
			this.rect = this.clampMove({ ...this.rect, x: this.rect.x + mx, y: this.rect.y + my });
		}
		this.render();
	}

	/** Integer crop rectangle sent to the server. */
	finalRect() {
		const x = Math.round(this.rect.x);
		const y = Math.round(this.rect.y);
		const w = Math.max(1, Math.min(Math.round(this.rect.w), this.nat.w - x));
		const h = Math.max(1, Math.min(Math.round(this.rect.h), this.nat.h - y));
		return { x, y, width: w, height: h };
	}

	render() {
		if (!this.nat.w) return;
		const r = this.rect;
		const s = this.scale;
		const box = this.$('[data-box]');
		box.style.left = `${r.x * s}px`;
		box.style.top = `${r.y * s}px`;
		box.style.width = `${r.w * s}px`;
		box.style.height = `${r.h * s}px`;

		const f = this.finalRect();
		this.$('[data-badge]').textContent = `${f.width} × ${f.height}`;
		this.$('[data-badge]').classList.toggle('hidden', r.w * s < 70 || r.h * s < 34);
		const wIn = this.$('[data-w]');
		const hIn = this.$('[data-h]');
		if (this.root.activeElement !== wIn) wIn.value = f.width;
		if (this.root.activeElement !== hIn) hIn.value = f.height;
		wIn.max = this.nat.w;
		hIn.max = this.nat.h;

		if (!this.nameEdited) {
			const info = this.info || {};
			// Same clean-up as the server (spaces -> dashes, no dots in the name).
			const base = (info.filename || '').replace(/\.[^.]+$/, '').trim().replace(/\s+/g, '-').replace(/\./g, '-');
			this.$('[data-name]').value = String(info.copy_name || '{name}-{width}x{height}')
				.split('{name}').join(base)
				.split('{width}').join(f.width)
				.split('{height}').join(f.height);
		}
	}

	updateMode() {
		const overwrite = this.mode() === 'overwrite';
		this.$('[data-name-row]').classList.toggle('hidden', overwrite);
		this.$('[data-warning]').classList.toggle('hidden', !overwrite);
		const save = this.$('[data-save]');
		save.textContent = overwrite ? t('saveOverwrite') : t('saveCopy');
		save.classList.toggle('primary', !overwrite);
		save.classList.toggle('danger', overwrite);
	}

	mode() {
		const checked = this.root.querySelector('input[name=mode]:checked');
		return checked ? checked.value : 'copy';
	}

	/* ---------- save ---------- */

	async save() {
		if (this.saving || !this.nat.w || this.$('[data-save]').disabled) return;
		const mode = this.mode();
		const rect = this.finalRect();
		const body = { ...this.targetParams(), ...rect, mode };
		if (mode === 'copy') body.name = this.$('[data-name]').value.trim();

		this.saving = true;
		const save = this.$('[data-save]');
		const label = save.textContent;
		save.disabled = true;
		save.textContent = t('saving');

		let result;
		try {
			result = await apiPost('/image-crop/crop', body);
		} catch (err) {
			this.saving = false;
			save.disabled = false;
			save.textContent = label;
			toast('error', errorMessage(err, t('errorSave')));
			return;
		}

		this.saving = false;
		this.close();

		if (mode === 'overwrite') {
			swapThumbnails(result.previous_thumbnail_url, result.thumbnail_url);
			toast('success', t('savedOverwrite', { name: result.filename, w: result.dimensions.width, h: result.dimensions.height }));
		} else {
			toast('success', t('savedCopy', { name: result.filename }));
		}
		refreshLists(result);
	}
}

/* ------------------------------------------------------------------------ */
/* After saving                                                              */
/* ------------------------------------------------------------------------ */

/** Show the new thumbnail right away wherever the old one is displayed. */
function swapThumbnails(previousUrl, nextUrl) {
	const oldHash = thumbHash(previousUrl);
	if (!oldHash || !nextUrl) return;
	const server = (window.__GRAV_API_SERVER_URL || '').replace(/\/$/, '');
	const absolute = /^https?:/.test(nextUrl) ? nextUrl : server + nextUrl;
	for (const img of document.querySelectorAll('img[src*="/thumbnails/"]')) {
		if (thumbHash(img.getAttribute('src')) === oldHash) img.src = absolute;
	}
}

/**
 * The API invalidation headers refresh the page editor; the Media manager
 * keeps its listing in memory, so reload the current folder by clicking the
 * last breadcrumb (it calls navigateTo(currentPath)).
 */
function refreshLists(result) {
	if (result.source !== 'site' || !isMediaManagerRoute()) return;
	setTimeout(() => {
		const crumbs = [...document.querySelectorAll('button')].filter((b) => {
			const bar = b.parentElement;
			return bar && bar.classList.contains('border-b') && bar.classList.contains('gap-1') && bar.firstElementChild && bar.firstElementChild.querySelector('svg');
		});
		const last = crumbs[crumbs.length - 1];
		if (last) last.click();
	}, 50);
}

function esc(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------------ */
/* Start (at the end of the module: every const above is initialised)        */
/* ------------------------------------------------------------------------ */

if (!window.__GRAV_IMAGE_CROP__) {
	window.__GRAV_IMAGE_CROP__ = { version: '1.0.0' };
	init();
}
