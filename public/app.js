const form = document.querySelector('#upload-form');
const fileInput = document.querySelector('#file-input');
const dropZone = document.querySelector('#drop-zone');
const submitButton = document.querySelector('#submit-button');
const errorBox = document.querySelector('#upload-error');
const successBox = document.querySelector('#upload-success');
const fileSelected = document.querySelector('#file-selected');
const selectedName = document.querySelector('#selected-name');
const fileTitle = document.querySelector('#file-title');
const fileSubtitle = document.querySelector('#file-subtitle');
const maxSizeLabel = document.querySelector('#max-size');
let maxFileMb = 50;

const prettySize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  successBox.hidden = true;
}
function clearMessages() {
  errorBox.hidden = true;
  successBox.hidden = true;
  errorBox.textContent = '';
}
function setFile(file) {
  if (!file) return;
  clearMessages();
  if (file.size > maxFileMb * 1024 * 1024) {
    fileInput.value = '';
    fileSelected.hidden = true;
    showError(`Ukuran file ${prettySize(file.size)} melebihi batas ${maxFileMb} MB.`);
    return;
  }
  selectedName.textContent = `${file.name} · ${prettySize(file.size)}`;
  fileTitle.textContent = file.name;
  fileSubtitle.textContent = `Dokumen dipilih · ${prettySize(file.size)}`;
  fileSelected.hidden = false;
}

fileInput.addEventListener('change', () => setFile(fileInput.files?.[0]));
document.querySelector('#remove-file').addEventListener('click', () => {
  fileInput.value = '';
  fileSelected.hidden = true;
  fileTitle.textContent = 'Pilih file atau tarik ke sini';
  fileSubtitle.innerHTML = `PDF, DOCX, XLSX, PPTX, TXT, CSV · Maks. <span id="max-size">${maxFileMb}</span> MB`;
  clearMessages();
});

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragover');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragover');
  });
}
dropZone.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  setFile(file);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessages();
  if (!fileInput.files?.length) return showError('Pilih file dokumen terlebih dahulu.');
  const data = new FormData(form);
  submitButton.disabled = true;
  submitButton.querySelector('span').textContent = 'Mengirim dokumen…';
  try {
    const response = await fetch('/api/upload', { method: 'POST', body: data });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Dokumen gagal diunggah.');
    document.querySelector('#success-title').textContent = result.whatsappStatus === 'sent' ? 'Dokumen berhasil dikirim' : 'Dokumen berhasil diunggah';
    document.querySelector('#success-text').textContent = result.message;
    document.querySelector('#success-id').textContent = `ID pengiriman: ${result.id}`;
    successBox.hidden = false;
    form.reset();
    fileInput.value = '';
    fileSelected.hidden = true;
    fileTitle.textContent = 'Pilih file atau tarik ke sini';
    fileSubtitle.innerHTML = `PDF, DOCX, XLSX, PPTX, TXT, CSV · Maks. <span id="max-size">${maxFileMb}</span> MB`;
    successBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    showError(error.message || 'Terjadi kesalahan. Coba kembali.');
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector('span').textContent = 'Kirim dokumen';
  }
});

fetch('/api/config').then((response) => response.json()).then((config) => {
  maxFileMb = Number(config.maxFileMb) || 50;
  maxSizeLabel.textContent = maxFileMb;
  const title = config.appName || 'TEAMDROP';
  document.title = `${title} — Private Team Workspace`;
}).catch(() => {});
document.querySelector('#year').textContent = new Date().getFullYear();
