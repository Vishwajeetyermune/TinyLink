// public/app.js (ES module)
const baseUrl = window.location.origin;

async function apiFetch(path, opts = {}) {
  const url = new URL(path, baseUrl);
  const res = await fetch(url.toString(), opts);
  return res;
}

function timeAgo(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString();
}

function truncate(str, n = 80) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

async function fetchLinks(q) {
  const url = new URL('/api/links', window.location.origin);
  if (q) url.searchParams.set('q', q);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
}

async function load(q) {
  const rows = document.getElementById('rows');
  const msg = document.getElementById('listMsg');
  rows.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
  try {
    const data = await fetchLinks(q);
    if (data.length === 0) {
      rows.innerHTML = '<tr><td colspan="5">No links</td></tr>';
      msg.innerText = '';
      return;
    }
    rows.innerHTML = data.map(r => `
      <tr class="border-t">
        <td class="px-2 py-2"><a class="text-blue-600" href="/${r.code}" target="_blank">${r.code}</a></td>
        <td class="px-2 py-2" title="${r.target_url}">${truncate(r.target_url, 120)}</td>
        <td class="px-2 py-2">${r.clicks}</td>
        <td class="px-2 py-2">${timeAgo(r.last_clicked)}</td>
        <td class="px-2 py-2">
          <button data-code="${r.code}" class="copyBtn mr-2 px-2 py-1 border rounded">Copy</button>
          <a href="/code/${r.code}" class="mr-2 text-sm underline">Stats</a>
          <button data-del="${r.code}" class="delBtn px-2 py-1 border rounded text-red-600">Delete</button>
        </td>
      </tr>
    `).join('');
    msg.innerText = `Loaded ${data.length} links`;
  } catch (err) {
    rows.innerHTML = '<tr><td colspan="5">Error loading links</td></tr>';
    msg.innerText = 'Error';
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Health
  const healthEl = document.getElementById('health');
  try {
    const h = await (await fetch('/healthz')).json();
    healthEl.innerText = h.ok ? 'ok' : 'down';
  } catch {
    healthEl.innerText = 'down';
  }

  const form = document.getElementById('createForm');
  const createMsg = document.getElementById('createMsg');
  const createBtn = document.getElementById('createBtn');
  const search = document.getElementById('search');
  const refresh = document.getElementById('refreshBtn');

  await load();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    createMsg.innerText = '';
    createBtn.disabled = true;

    const target_url = document.getElementById('target_url').value.trim();
    const code = document.getElementById('code').value.trim();

    // Inline validation
    if (!target_url) {
      createMsg.innerText = 'Target URL is required';
      createBtn.disabled = false;
      return;
    }

    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_url, code: code || undefined })
      });

      if (res.status === 201) {
        createMsg.innerText = 'Created!';
        form.reset();
        await load();
      } else {
        const body = await res.json().catch(() => ({}));
        createMsg.innerText = 'Error: ' + (body.error || 'unknown');
      }
    } catch (err) {
      createMsg.innerText = 'Network error';
      console.error(err);
    } finally {
      createBtn.disabled = false;
    }
  });

  refresh.addEventListener('click', () => load(search.value));

  search.addEventListener('input', (e) => {
    if (window._searchTimer) clearTimeout(window._searchTimer);
    window._searchTimer = setTimeout(() => load(e.target.value), 300);
  });

  document.getElementById('rows').addEventListener('click', async (e) => {
    if (e.target.matches('.copyBtn')) {
      const code = e.target.dataset.code;
      const url = `${window.location.origin}/${code}`;
      try {
        await navigator.clipboard.writeText(url);
        e.target.innerText = 'Copied';
        setTimeout(() => e.target.innerText = 'Copy', 1200);
      } catch {
        alert('Copy failed.');
      }
    } else if (e.target.matches('.delBtn')) {
      const code = e.target.dataset.del;
      if (!confirm(`Delete ${code}? This cannot be undone.`)) return;
      try {
        const res = await fetch(`/api/links/${code}`, { method: 'DELETE' });
        if (res.status === 204) {
          await load();
        } else {
          const body = await res.json().catch(() => ({}));
          alert('Delete failed: ' + (body.error || res.status));
        }
      } catch (err) {
        alert('Delete network error');
      }
    }
  });
});
