import { useEffect, useState } from 'react';
import { captionJob, type CaptionJobState } from '../services/captionJob';

/** Suit l'écriture des légendes en tâche de fond. `null` : rien en cours. */
export function useCaptionJob(albumId?: string): CaptionJobState | null {
  const [state, setState] = useState<CaptionJobState | null>(captionJob.snapshot());
  useEffect(() => captionJob.subscribe(setState), []);
  if (albumId && state && state.albumId !== albumId) return null;
  return state;
}
