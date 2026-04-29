(() => {
  const API = (window.KANPLAY && window.KANPLAY.api) || location.origin;
  const DIRS = [
    { token: 'songs/user',       label: 'Songs (user)' },
    { token: 'songs/extra',      label: 'Songs (extra)' },
    { token: 'arpeggio/user',    label: 'Arpeggio (user)' },
    { token: 'progression/user', label: 'Progression (user)' },
  ];

  const root = document.getElementById('app');
  if (!root) return;

  let currentDir = DIRS[0].token;

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') e.className = attrs[k];
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
        else e.setAttribute(k, attrs[k]);
      }
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  async function api(method, path, body) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = body;
    }
    const r = await fetch(API + path, opts);
    if (!r.ok) {
      let msg = r.status + ' ' + r.statusText;
      try {
        const j = await r.json();
        if (j && j.error) msg += ': ' + j.error;
      } catch (_) { /* not json */ }
      throw new Error(msg);
    }
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) return r.json();
    return r.text();
  }

  function render() {
    root.innerHTML = '';
    const tabs = el('div', { class: 'tabs' },
      ...DIRS.map(d =>
        el('button', {
          class: 'tab' + (d.token === currentDir ? ' active' : ''),
          onclick: () => { currentDir = d.token; render(); refresh(); },
        }, d.label)
      )
    );
    root.appendChild(el('div', { class: 'wrap' },
      el('h1', null, 'KANTAN Play - Files'),
      tabs,
      el('ul', { class: 'list', id: 'list' },
        el('li', { class: 'loading' }, 'Loading…')
      ),
      el('div', { class: 'upload' },
        el('input', { type: 'file', id: 'file', accept: '.json' }),
        el('button', { onclick: doUpload }, 'Upload')
      ),
      el('div', { id: 'status', class: 'status' })
    ));
    refresh();
  }

  function setStatus(msg, kind) {
    const s = document.getElementById('status');
    if (!s) return;
    s.textContent = msg || '';
    s.className = 'status' + (kind ? ' ' + kind : '');
  }

  async function refresh() {
    const list = document.getElementById('list');
    list.innerHTML = '';
    list.appendChild(el('li', { class: 'loading' }, 'Loading…'));
    try {
      const data = await api('GET', '/api/files/' + currentDir);
      list.innerHTML = '';
      if (!data.files || data.files.length === 0) {
        list.appendChild(el('li', { class: 'empty' }, '(empty)'));
        return;
      }
      for (const f of data.files) {
        list.appendChild(el('li', { class: 'item' },
          el('span', { class: 'name' }, f.name),
          el('span', { class: 'size' }, f.size + ' B'),
          el('button', { onclick: () => doDownload(f.name) }, 'Download'),
          el('button', { class: 'danger', onclick: () => doDelete(f.name) }, 'Delete')
        ));
      }
      setStatus('');
    } catch (e) {
      list.innerHTML = '';
      list.appendChild(el('li', { class: 'list-error' }, 'Error: ' + e.message));
    }
  }

  async function doDownload(name) {
    try {
      setStatus('Downloading ' + name + ' …');
      const r = await fetch(API + '/api/files/' + currentDir + '/' + encodeURIComponent(name));
      if (!r.ok) {
        let msg = r.status + ' ' + r.statusText;
        try { const j = await r.json(); if (j && j.error) msg += ': ' + j.error; } catch (_) { /* not json */ }
        throw new Error(msg);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus('Downloaded ' + name, 'ok');
    } catch (e) {
      setStatus('Download failed: ' + e.message, 'error');
    }
  }

  async function doDelete(name) {
    if (!confirm('Delete ' + name + '?')) return;
    try {
      setStatus('Deleting ' + name + ' …');
      await api('DELETE', '/api/files/' + currentDir + '/' + encodeURIComponent(name));
      setStatus('Deleted ' + name, 'ok');
      refresh();
    } catch (e) {
      setStatus('Delete failed: ' + e.message, 'error');
    }
  }

  async function doUpload() {
    const input = document.getElementById('file');
    const f = input && input.files[0];
    if (!f) { setStatus('Please select a file', 'error'); return; }
    if (!f.name.toLowerCase().endsWith('.json')) {
      setStatus('Only .json files can be uploaded', 'error');
      return;
    }
    try {
      const text = await f.text();
      setStatus('Uploading ' + f.name + ' …');
      await api('PUT',
        '/api/files/' + currentDir + '/' + encodeURIComponent(f.name),
        text
      );
      setStatus('Uploaded ' + f.name, 'ok');
      input.value = '';
      refresh();
    } catch (e) {
      setStatus('Upload failed: ' + e.message, 'error');
    }
  }

  render();
})();
