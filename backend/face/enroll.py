import os
from typing import List, Tuple

import numpy as np


def _ensure_parent(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)


def append_embeddings(embeddings_path: str, new_embs: np.ndarray) -> int:
    """
    Append embeddings to a .npy file (NxD). Creates if missing.
    Returns number of embeddings appended.
    """
    if new_embs is None or new_embs.size == 0:
        return 0
    new_embs = new_embs.astype(np.float32)
    if new_embs.ndim == 1:
        new_embs = new_embs.reshape(1, -1)

    _ensure_parent(embeddings_path)
    if os.path.exists(embeddings_path):
        existing = np.load(embeddings_path)
        if existing.ndim == 1:
            existing = existing.reshape(1, -1)
        combined = np.concatenate([existing, new_embs], axis=0)
        np.save(embeddings_path, combined)
        return int(new_embs.shape[0])

    np.save(embeddings_path, new_embs)
    return int(new_embs.shape[0])


def enroll_images_for_person(
    person_id: str,
    image_paths: List[str],
    known_store,
    face_recognizer,
) -> Tuple[int, int]:
    """
    For each image path, compute one face embedding (best face) and append to embeddings.npy.
    Returns: (processed_images, embeddings_added)
    """
    import cv2

    processed = 0
    added = 0

    emb_path = known_store.embeddings_path(person_id)
    for path in image_paths:
        img = cv2.imread(path)
        processed += 1
        if img is None:
            continue
        emb = face_recognizer.embed_bgr(img)
        if emb is None:
            continue
        added += append_embeddings(emb_path, emb)

    # Refresh cache after update
    face_recognizer.reload_known()
    return processed, added

