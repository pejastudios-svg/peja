// Drain handlers for Election Watch actions queued while offline.
// Both throw on failure so the outbox bumps attempts and retries; both
// scrub their footprint (IndexedDB blob, and with it the queued PIN once
// the item is removed by the drain) on success.

import { authFetchJson } from "@/lib/authFetch";
import { getDraftBlob, deleteDraftBlobs } from "../postDraftBlobs";
import type { ElectionUploadPayload, ElectionTallyPayload } from "../outbox";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the queued photo"));
    reader.readAsDataURL(blob);
  });
}

export async function dispatchElectionUpload(payload: ElectionUploadPayload): Promise<void> {
  const blob = await getDraftBlob(payload.draft_id, payload.media_id);
  if (!blob) {
    // The photo bytes are gone (storage cleared). Nothing to upload;
    // surfacing a permanent error beats retrying forever.
    throw new Error("Queued photo is no longer on this device");
  }
  const photoDataUrl = await blobToDataUrl(blob);

  const { res, data } = await authFetchJson(`/api/elections/${payload.election_id}/upload`, {
    method: "POST",
    body: JSON.stringify({
      pin: payload.pin,
      state: payload.state,
      lga: payload.lga,
      pollingUnit: payload.polling_unit || undefined,
      photoDataUrl,
      deviceLat: payload.device_lat ?? undefined,
      deviceLng: payload.device_lng ?? undefined,
      deviceAccuracyM: payload.device_accuracy_m ?? undefined,
    }),
  });
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Upload failed (${res.status})`);
  }
  await deleteDraftBlobs(payload.draft_id).catch(() => {});
}

export async function dispatchElectionTally(payload: ElectionTallyPayload): Promise<void> {
  const { res, data } = await authFetchJson(`/api/elections/${payload.election_id}/tally`, {
    method: "POST",
    body: JSON.stringify({
      pin: payload.pin,
      uploadId: payload.upload_id,
      figures: payload.figures,
      note: payload.note || undefined,
      deviceLat: payload.device_lat ?? undefined,
      deviceLng: payload.device_lng ?? undefined,
    }),
  });
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Tally failed (${res.status})`);
  }
}
