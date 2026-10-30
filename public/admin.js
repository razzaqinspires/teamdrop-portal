const loginView = document.querySelector('#login-view');
const dashboardView = document.querySelector('#dashboard-view');
const loginForm = document.querySelector('#login-form');
const loginError = document.querySelector('#login-error');
const rows = document.querySelector('#submissions-body');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}
function statusLabel(status) {
  if (status === 'sent') return ['status-sent', 'Terkirim'];
  if (status === 'failed') return ['status-failed', 'Gagal'];
  if (status === 'not_configured') return ['status-not_configured', 'Belum dikonfigurasi'];
  return ['status-pending', 'Menunggu'];
}
function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Permintaan gagal.');
  return result;
}
function showDashboard() {
  loginView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  loadSubmissions();
}
function showLogin() {
  dashboardView.classList.add('hidden');
  loginView.classList.remove('hidden');
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.classList.add('hidden');
  const button = loginForm.querySelector('button');
  button.disabled = true;
  button.textContent = 'Memeriksa…';
  try {
    const data = Object.fromEntries(new FormData(loginForm));
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify(data) });
    loginForm.reset();
    showDashboard();
  } catch (error) {
    loginError.textContent = error.message;
    loginError.classList.remove('hidden');
  } finally {
    button.disabled = false;
    button.textContent = 'Masuk ke dashboard →';
  }
});

async function loadSubmissions() {
  rows.innerHTML = '<tr><td colspan="5"><div class="empty-state">Memuat dokumen…</div></td></tr>';
  try {
    const result = await api('/api/admin/submissions');
    document.querySelector('#stat-total').textContent = result.stats.total;
    document.querySelector('#stat-sent').textContent = result.stats.sent;
    document.querySelector('#stat-pending').textContent = result.stats.pending;
    document.querySelector('#stat-failed').textContent = result.stats.failed;
    if (!result.submissions.length) {
      rows.innerHTML = '<tr><td colspan="5"><div class="empty-state"><b>Belum ada dokumen masuk</b>Kiriman dari anggota tim akan tampil di sini.</div></td></tr>';
      return;
    }
    rows.innerHTML = result.submissions.map((item) => {
      const [statusClass, label] = statusLabel(item.whatsappStatus);
      const error = item.whatsappError ? `<span class="subline" title="${escapeHtml(item.whatsappError)}">${escapeHtml(item.whatsappError.slice(0, 95))}</span>` : '';
      const retry = item.whatsappStatus !== 'sent'
        ? `<button type="button" data-retry="${escapeHtml(item.id)}">Coba kirim</button>`
        : '';
      return `<tr>
        <td><div class="file-name">${escapeHtml(item.originalName)}</div><span class="subline">${escapeHtml(item.sizeLabel)} · ${escapeHtml(item.id.slice(0, 8))}</span></td>
        <td><strong>${escapeHtml(item.senderName)}</strong><span class="subline">${escapeHtml(item.teamName)}</span>${item.note ? `<span class="subline">Catatan: ${escapeHtml(item.note)}</span>` : ''}</td>
        <td>${escapeHtml(formatDate(item.createdAt))}</td>
        <td><span class="status-pill ${statusClass}">${label}</span>${error}</td>
        <td><div class="row-actions"><a href="/api/admin/submissions/${encodeURIComponent(item.id)}/download">Unduh</a>${retry}</div></td>
      </tr>`;
    }).join('');
  } catch (error) {
    rows.innerHTML = `<tr><td colspan="5"><div class="empty-state"><b>Gagal memuat data</b>${escapeHtml(error.message)}</div></td></tr>`;
  }
}

rows.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-retry]');
  if (!button) return;
  const id = button.dataset.retry;
  button.disabled = true;
  button.textContent = 'Mengirim…';
  try {
    const result = await api(`/api/admin/submissions/${encodeURIComponent(id)}/retry`, { method: 'POST', body: '{}' });
    if (result.status === 'sent') window.alert('Dokumen berhasil dikirim ke WhatsApp.');
    else window.alert(result.error || 'Dokumen belum berhasil dikirim. Periksa konfigurasi WhatsApp.');
  } catch (error) {
    window.alert(error.message);
  } finally {
    await loadSubmissions();
  }
});

document.querySelector('#refresh-button').addEventListener('click', loadSubmissions);
document.querySelector('#logout-button').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); } catch {}
  showLogin();
});

api('/api/admin/session').then((result) => {
  if (result.authenticated) showDashboard();
  else showLogin();
}).catch(showLogin);
