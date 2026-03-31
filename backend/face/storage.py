import json
import os
import re
from dataclasses import dataclass
from typing import Dict, List, Optional
from uuid import uuid4


_SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9._ -]+")


def _slugify(name: str) -> str:
    name = (name or "").strip()
    name = _SAFE_NAME_RE.sub("", name)
    name = name.strip().replace(" ", "_")
    return name or "person"


@dataclass(frozen=True)
class Person:
    id: str
    name: str


class KnownPeopleStore:
    """
    Disk-backed store for enrolled identities.

    Layout:
      known_people/
        index.json
        <person_id>_<slug>/
          images/
            *.jpg|png
          embeddings.npy
    """

    def __init__(self, root_dir: str = "known_people"):
        self.root_dir = root_dir
        self.index_path = os.path.join(self.root_dir, "index.json")
        os.makedirs(self.root_dir, exist_ok=True)
        self._index: Dict[str, Dict[str, str]] = self._load_index()

    def _load_index(self) -> Dict[str, Dict[str, str]]:
        try:
            with open(self.index_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                return data
        except FileNotFoundError:
            pass
        except Exception as e:
            print(f"[KnownPeopleStore] Failed to load index: {e}")
        return {}

    def _save_index(self) -> None:
        tmp_path = self.index_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(self._index, f, indent=2)
        os.replace(tmp_path, self.index_path)

    def list_people(self) -> List[Person]:
        out: List[Person] = []
        for person_id, rec in self._index.items():
            out.append(Person(id=person_id, name=str(rec.get("name", person_id))))
        out.sort(key=lambda p: p.name.lower())
        return out

    def get_person(self, person_id: str) -> Optional[Person]:
        rec = self._index.get(person_id)
        if not rec:
            return None
        return Person(id=person_id, name=str(rec.get("name", person_id)))

    def create_person(self, name: str) -> Person:
        person_id = str(uuid4())
        slug = _slugify(name)
        folder = f"{person_id}_{slug}"
        self._index[person_id] = {"name": name, "folder": folder}
        os.makedirs(self.person_dir(person_id), exist_ok=True)
        os.makedirs(self.images_dir(person_id), exist_ok=True)
        self._save_index()
        return Person(id=person_id, name=name)

    def delete_person(self, person_id: str) -> bool:
        rec = self._index.get(person_id)
        if not rec:
            return False
        # Keep it simple/safe: remove from index only (do not delete files by default).
        # You can manually clean the folder if needed.
        del self._index[person_id]
        self._save_index()
        return True

    def person_dir(self, person_id: str) -> str:
        folder = self._index.get(person_id, {}).get("folder")
        if not folder:
            folder = f"{person_id}_{person_id}"
        return os.path.join(self.root_dir, folder)

    def images_dir(self, person_id: str) -> str:
        return os.path.join(self.person_dir(person_id), "images")

    def embeddings_path(self, person_id: str) -> str:
        return os.path.join(self.person_dir(person_id), "embeddings.npy")

