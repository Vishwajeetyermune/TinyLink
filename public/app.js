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

function resetAllCopyButtons() {
  document.querySelectorAll('.copyBtn').forEach(btn => {
    btn.innerText = 'Copy';
    btn.classList.remove("bg-green-700");
    btn.classList.add("bg-green-500");
  });
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
    
        <!-- Code -->
        <td class="px-3 py-2 w-28 font-mono">
          <a href="/${r.code}" 
             target="_blank" 
             class="text-blue-600 underline">
            ${r.code}
          </a>
        </td>
    
        <!-- URL -->
        <td class="px-3 py-2 truncate max-w-xs" title="${r.target_url}">
          <a href="${r.target_url}" 
             target="_blank" 
             class="text-blue-600 underline">
            ${truncate(r.target_url, 80)}
          </a>
        </td>
    
        <!-- Clicks -->
        <td class="px-3 py-2 text-center w-20">
          ${r.clicks}
        </td>
    
        <!-- Last clicked -->
        <td class="px-3 py-2 w-28 text-gray-500">
          ${timeAgo(r.last_clicked)}
        </td>
    
        <!-- Actions -->
        <td class="px-3 py-2 w-36">
          <div class="flex items-center gap-2">
    
            <!-- Fixed-width copy button, green & stable -->
            <button 
              data-code="${r.code}" 
              class="copyBtn bg-green-500 text-white px-2 py-1 rounded text-xs w-16 text-center">
              Copy
            </button>
    
            <!-- Stats button -->
            <a href="/code/${r.code}" 
               class="bg-gray-200 px-2 py-1 rounded text-xs w-16 text-center">
              Stats
            </a>
    
            <!-- Delete button -->
            <button 
              data-del="${r.code}" 
              class="delBtn bg-red-500 text-white px-2 py-1 rounded text-xs w-16 text-center">
              Del
            </button>
    
          </div>
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
  const healthDot = document.getElementById('healthDot');
  try {
    const h = await (await fetch('/healthz')).json();
    
    if (h.ok) {
      healthDot.classList.remove("bg-red-500", "bg-gray-400");
      healthDot.classList.add("bg-green-500");
    } else {
      healthDot.classList.remove("bg-green-500", "bg-gray-400");
      healthDot.classList.add("bg-red-500");
    }
  
  } catch {
    healthDot.classList.remove("bg-green-500", "bg-gray-400");
    healthDot.classList.add("bg-red-500");
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
          resetAllCopyButtons();
          e.target.innerText = 'Copied';
          e.target.classList.remove("bg-green-500");
          e.target.classList.add("bg-green-700");
          
          setTimeout(() => {
            e.target.classList.add("bg-green-500");
            e.target.classList.remove("bg-green-700");
          }, 600);
        
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
