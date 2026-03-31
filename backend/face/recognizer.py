import os
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np


def _l2_normalize(x: np.ndarray, eps: float = 1e-12) -> np.ndarray:
    denom = np.linalg.norm(x, axis=-1, keepdims=True)
    return x / np.clip(denom, eps, None)


@dataclass(frozen=True)
class FaceMatch:
    person_id: Optional[str]
    person_name: Optional[str]
    distance: float


class FaceRecognizer:
    """
    Face pipeline based on facenet-pytorch:
      - MTCNN for face detection
      - InceptionResnetV1 (FaceNet) for embeddings
    """

    def __init__(
        self,
        known_store,
        device: Optional[str] = None,
        threshold: float = 0.9,
        min_face_size: int = 60,
    ):
        self.known_store = known_store
        self.threshold = float(threshold)
        self.min_face_size = int(min_face_size)

        # Lazy import so the rest of the backend can run without these deps installed yet.
        import torch
        from facenet_pytorch import InceptionResnetV1, MTCNN

        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = device

        self.mtcnn = MTCNN(
            image_size=160,
            margin=20,
            min_face_size=self.min_face_size,
            thresholds=[0.6, 0.7, 0.7],
            factor=0.709,
            post_process=True,
            device=self.device,
            keep_all=True,
        )
        self.model = InceptionResnetV1(pretrained="vggface2").eval().to(self.device)

        self._known: Dict[str, Dict[str, object]] = {}
        self.reload_known()

    def reload_known(self) -> None:
        """
        Load all embeddings from disk into memory.
        Structure: self._known[person_id] = { name: str, embeddings: (N, D) np.ndarray }
        """
        import numpy as np

        known: Dict[str, Dict[str, object]] = {}
        for p in self.known_store.list_people():
            emb_path = self.known_store.embeddings_path(p.id)
            if not os.path.exists(emb_path):
                continue
            try:
                embs = np.load(emb_path)
                if embs.ndim == 1:
                    embs = embs.reshape(1, -1)
                if embs.size == 0:
                    continue
                embs = _l2_normalize(embs.astype(np.float32))
                known[p.id] = {"name": p.name, "embeddings": embs}
            except Exception as e:
                print(f"[FaceRecognizer] Failed to load embeddings for {p.id}: {e}")
        self._known = known
        print(f"[FaceRecognizer] Loaded embeddings for {len(self._known)} people")

    def embed_bgr(self, bgr_image: np.ndarray) -> Optional[np.ndarray]:
        """
        Returns a single embedding for the best detected face in the image, or None.
        Input: OpenCV BGR image array.
        """
        import cv2
        import torch

        if bgr_image is None or bgr_image.size == 0:
            return None

        rgb = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2RGB)
        # mtcnn returns aligned face tensors if return_prob or return_landmarks requested?
        # Here we use mtcnn to extract faces as tensors.
        faces = self.mtcnn(rgb)  # keep_all=True -> tensor (N,3,160,160) or None
        if faces is None:
            return None

        if isinstance(faces, (list, tuple)):
            # Some versions may return list; normalize to tensor.
            faces = torch.stack([f for f in faces if f is not None], dim=0) if faces else None
        if faces is None or getattr(faces, "ndim", 0) != 4 or faces.shape[0] == 0:
            return None

        faces = faces.to(self.device)
        with torch.no_grad():
            embs = self.model(faces).detach().cpu().numpy().astype(np.float32)
        embs = _l2_normalize(embs)
        # Choose the first face (or could choose by box size; good enough for v1).
        return embs[0]

    def match_embedding(self, emb: np.ndarray) -> FaceMatch:
        """
        Compare an embedding to all known embeddings.
        Distance: cosine distance on L2-normalized vectors = 1 - dot(u, v)
        """
        if emb is None or emb.size == 0 or not self._known:
            return FaceMatch(person_id=None, person_name=None, distance=1e9)

        emb = _l2_normalize(emb.astype(np.float32))
        best_id: Optional[str] = None
        best_name: Optional[str] = None
        best_dist = 1e9

        for person_id, rec in self._known.items():
            known_embs: np.ndarray = rec["embeddings"]  # type: ignore[assignment]
            # cosine distance = 1 - cosine similarity
            sims = known_embs @ emb
            dist = float(1.0 - float(np.max(sims)))
            if dist < best_dist:
                best_dist = dist
                best_id = person_id
                best_name = str(rec["name"])

        if best_dist <= self.threshold:
            return FaceMatch(person_id=best_id, person_name=best_name, distance=best_dist)
        return FaceMatch(person_id=None, person_name=None, distance=best_dist)

    def identify_bgr(self, bgr_image: np.ndarray) -> FaceMatch:
        emb = self.embed_bgr(bgr_image)
        return self.match_embedding(emb) if emb is not None else FaceMatch(None, None, 1e9)

