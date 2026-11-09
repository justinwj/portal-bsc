'use strict';
const form = document.getElementById('upload-form');
let running = false;
let attempt;
async function uploadResponse(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || 'Upload request did not complete. Inspect its status before retrying.');
  return body;
}
form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (running) return;
  running = true;
  const status = document.getElementById('upload-status');
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const file = form.elements.file.files[0];
    if (!file) throw new Error('Choose a file.');
    const headers = { 'x-csrf-token': form.elements._csrf.value };
    const metadata = { originalFilename: file.name, title: form.elements.title.value, description: form.elements.description.value, sizeBytes: String(file.size) };
    const fingerprint = JSON.stringify([metadata, file.lastModified]);
    if (!attempt || attempt.fingerprint !== fingerprint) attempt = { fingerprint, key: crypto.randomUUID() };
    let reservation;
    if (attempt.id) {
      status.textContent = 'Checking the previous upload outcome…';
      reservation = await uploadResponse(await fetch(`/uploads/${encodeURIComponent(attempt.id)}`, { headers }));
    } else {
      status.textContent = 'Reserving storage…';
      reservation = await uploadResponse(await fetch('/uploads/intents', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ ...metadata, idempotencyKey: attempt.key }) }));
      attempt.id = reservation.id;
    }
    if (reservation.state === 'committed') {
      location.assign(`/files/${encodeURIComponent(reservation.id)}`);
      return;
    }
    if (reservation.state === 'aborted') {
      attempt = undefined;
      throw new Error('The previous upload was aborted and cleaned. Submit again to begin a fresh upload.');
    }
    if (reservation.state !== 'reserved') throw new Error('The previous upload is still processing or needs recovery. Check again before starting another upload.');
    status.textContent = 'Uploading and finalizing…';
    const result = await fetch(`/uploads/${encodeURIComponent(reservation.id)}/content`, { method: 'PUT', headers: { ...headers, 'content-type': 'application/octet-stream' }, body: file });
    const outcome = await uploadResponse(result);
    location.assign(`/files/${encodeURIComponent(outcome.id)}`);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Upload did not complete.';
  } finally {
    running = false;
    button.disabled = false;
  }
});
