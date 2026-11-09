'use strict';
const form = document.getElementById('upload-form');
form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.getElementById('upload-status');
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const file = form.elements.file.files[0];
    if (!file) throw new Error('Choose a file.');
    const headers = { 'x-csrf-token': form.elements._csrf.value };
    status.textContent = 'Reserving storage…';
    const intent = await fetch('/uploads/intents', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ originalFilename: file.name, title: form.elements.title.value, description: form.elements.description.value, sizeBytes: String(file.size), idempotencyKey: crypto.randomUUID() }) });
    const reservation = await intent.json();
    if (!intent.ok) throw new Error(reservation.message || 'Storage could not be reserved.');
    status.textContent = 'Uploading and finalizing…';
    const result = await fetch(`/uploads/${encodeURIComponent(reservation.id)}/content`, { method: 'PUT', headers: { ...headers, 'content-type': 'application/octet-stream' }, body: file });
    const outcome = await result.json();
    if (!result.ok) throw new Error(outcome.message || 'Upload failed. Inspect its status before retrying.');
    location.assign(`/files/${encodeURIComponent(outcome.id)}`);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Upload did not complete.';
    button.disabled = false;
  }
});
