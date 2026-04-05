import { useEffect, useMemo, useState } from "react";
import { COCO_CLASS_NAMES, formatCocoLabel } from "../constants/cocoClasses";
import { createPerson, listPeople, uploadPersonImages, type KnownPerson } from "../services/api";
import type { AlertSeverity, PersonIdentityMode, Zone, ZoneTriggerType } from "../types/types";

type ZonePropertiesPanelProps = {
  isOpen: boolean;
  zone: Zone | null;
  onClose: () => void;
  onChange: (zone: Zone) => void;
  onSave: (zone: Zone) => Promise<void>;
};

const ruleOptions: Array<{ value: ZoneTriggerType; label: string }> = [
  { value: "enter", label: "Enter zone" },
  { value: "exit", label: "Exit zone" },
  { value: "loitering", label: "Loitering (time threshold)" },
];

const severityClasses: Record<AlertSeverity, string> = {
  info: "bg-blue-600 text-white",
  warn: "bg-yellow-500 text-black",
  critical: "bg-red-600 text-white",
};

export default function ZonePropertiesPanel({
  isOpen,
  zone,
  onClose,
  onChange,
  onSave,
}: ZonePropertiesPanelProps) {
  if (!isOpen || !zone) {
    return null;
  }

  const personLogicEnabled = zone.rule.objectClasses.includes("person");
  const [people, setPeople] = useState<KnownPerson[]>([]);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [uploadingForPersonId, setUploadingForPersonId] = useState<string | null>(null);

  const selectedIdentity = zone.rule.personIdentity ?? null;
  const selectedIds = useMemo(() => new Set(selectedIdentity?.personIds ?? []), [selectedIdentity]);

  useEffect(() => {
    if (!isOpen) return;
    if (!personLogicEnabled) return;
    let cancelled = false;
    setLoadingPeople(true);
    setPeopleError(null);
    listPeople()
      .then((data) => {
        if (cancelled) return;
        setPeople(data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPeopleError(e instanceof Error ? e.message : "Failed to load people");
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingPeople(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, personLogicEnabled]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-700 bg-[#11161D] p-5 shadow-2xl">
        <div className="mb-4">
          <h3 className="text-sm font-semibold">Zone Properties</h3>
          <p className="mt-1 text-xs text-gray-400">Configure the zone, then click Save Zone.</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-400">ZONE NAME</label>
            <input
              className="mt-1 w-full rounded border border-gray-700 bg-black p-2 text-sm"
              value={zone.name}
              onChange={(event) => onChange({ ...zone, name: event.target.value })}
            />
          </div>

          <div>
            <label className="text-xs text-gray-400">TRIGGER OBJECTS</label>
            <p className="mt-1 text-xs text-gray-500">
              COCO classes (YOLO default), or match any class when nothing is selected.
            </p>

            <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                className="mt-1 rounded border-gray-600"
                checked={zone.rule.objectClasses.length === 0}
                onChange={(event) => {
                  if (event.target.checked) {
                    onChange({
                      ...zone,
                      rule: { ...zone.rule, objectClasses: [] },
                    });
                  } else {
                    onChange({
                      ...zone,
                      rule: { ...zone.rule, objectClasses: ["person"] },
                    });
                  }
                }}
              />
              <span>
                <span className="font-medium text-gray-200">Match any object</span>
                <span className="block text-xs font-normal text-gray-500">
                  Zone triggers for every detection class (empty list on the backend).
                </span>
              </span>
            </label>

            {zone.rule.objectClasses.length > 0 ? (
              <ul className="mt-2 flex max-h-24 flex-wrap gap-2 overflow-y-auto">
                {zone.rule.objectClasses.map((cls) => (
                  <li
                    key={cls}
                    className="flex items-center gap-0.5 rounded-full border border-gray-600 bg-black/60 pl-2 pr-0.5 text-xs text-gray-200"
                  >
                    <span>{formatCocoLabel(cls)}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${cls}`}
                      className="rounded px-1.5 py-0.5 text-gray-400 hover:bg-gray-800 hover:text-white"
                      onClick={() => {
                        const next = zone.rule.objectClasses.filter((c) => c !== cls);
                        const shouldClearPersonIdentity = cls === "person" && !next.includes("person");
                        onChange({
                          ...zone,
                          rule: {
                            ...zone.rule,
                            objectClasses: next,
                            personIdentity: shouldClearPersonIdentity ? null : zone.rule.personIdentity ?? null,
                          },
                        });
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-gray-500">
                Use the list below if you only want certain classes; the first selection switches off
                &quot;match any&quot;.
              </p>
            )}

            <select
              key={zone.rule.objectClasses.join("|")}
              className="mt-2 w-full rounded border border-gray-700 bg-black p-2 text-sm"
              defaultValue=""
              onChange={(event) => {
                const v = event.target.value;
                if (!v || zone.rule.objectClasses.includes(v)) return;
                onChange({
                  ...zone,
                  rule: {
                    ...zone.rule,
                    objectClasses: [...zone.rule.objectClasses, v],
                    personIdentity: zone.rule.personIdentity ?? null,
                  },
                });
              }}
            >
              <option value="" disabled>
                Add class…
              </option>
              {COCO_CLASS_NAMES.filter((name) => !zone.rule.objectClasses.includes(name)).map((name) => (
                <option key={name} value={name}>
                  {formatCocoLabel(name)}
                </option>
              ))}
            </select>
          </div>

          {personLogicEnabled && (
            <div>
              <label className="text-xs text-gray-400">PERSON IDENTITY</label>
              <p className="mt-1 text-xs text-gray-500">
                Choose whitelist/blacklist first, then enroll/select people. Unknown faces are treated as “not in list”.
              </p>

              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["whitelist", "blacklist"] as PersonIdentityMode[]).map((mode) => {
                  const selected = selectedIdentity?.mode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      className={`rounded border px-3 py-2 text-xs font-semibold ${
                        selected ? "border-blue-500 bg-blue-600 text-white" : "border-gray-700 bg-black text-gray-200"
                      }`}
                      onClick={() => {
                        onChange({
                          ...zone,
                          rule: {
                            ...zone.rule,
                            personIdentity: { mode, personIds: selectedIdentity?.personIds ?? [] },
                          },
                        });
                      }}
                    >
                      {mode === "whitelist" ? "Whitelist (allowed)" : "Blacklist (blocked)"}
                    </button>
                  );
                })}
              </div>

              {selectedIdentity ? (
                <div className="mt-3 rounded border border-gray-700 bg-black/40 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      className="flex-1 rounded border border-gray-700 bg-black p-2 text-sm"
                      placeholder="Create person (name)"
                      value={newPersonName}
                      onChange={(e) => setNewPersonName(e.target.value)}
                    />
                    <button
                      type="button"
                      className="rounded bg-[#151B22] px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50"
                      disabled={!newPersonName.trim()}
                      onClick={async () => {
                        const name = newPersonName.trim();
                        if (!name) return;
                        const created = await createPerson(name);
                        setPeople((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
                        setNewPersonName("");
                      }}
                    >
                      Add
                    </button>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">SELECT PEOPLE</span>
                      {loadingPeople ? (
                        <span className="text-xs text-gray-500">Loading…</span>
                      ) : peopleError ? (
                        <span className="text-xs text-red-400">{peopleError}</span>
                      ) : null}
                    </div>

                    <div className="mt-2 max-h-32 space-y-2 overflow-y-auto">
                      {people.length === 0 ? (
                        <p className="text-xs text-gray-500">No enrolled people yet. Create one above, then upload photos.</p>
                      ) : (
                        people.map((p) => {
                          const checked = selectedIds.has(p.id);
                          return (
                            <div key={p.id} className="flex items-center justify-between gap-2">
                              <label className="flex items-center gap-2 text-sm text-gray-200">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const nextIds = new Set(selectedIds);
                                    if (e.target.checked) nextIds.add(p.id);
                                    else nextIds.delete(p.id);
                                    onChange({
                                      ...zone,
                                      rule: {
                                        ...zone.rule,
                                        personIdentity: { ...selectedIdentity, personIds: Array.from(nextIds) },
                                      },
                                    });
                                  }}
                                />
                                <span>{p.name}</span>
                              </label>

                              <input
                                type="file"
                                multiple
                                accept="image/*"
                                className="text-xs text-gray-400"
                                disabled={uploadingForPersonId === p.id}
                                onChange={async (e) => {
                                  const files = Array.from(e.target.files ?? []);
                                  if (files.length === 0) return;
                                  setUploadingForPersonId(p.id);
                                  try {
                                    await uploadPersonImages(p.id, files);
                                  } finally {
                                    setUploadingForPersonId(null);
                                    e.currentTarget.value = "";
                                  }
                                }}
                              />
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-gray-500">Select whitelist or blacklist to enable person identity rules.</p>
              )}
            </div>
          )}

          <div>
            <label className="text-xs text-gray-400">ACTIVE RULE</label>
            <select
              className="mt-1 w-full rounded border border-gray-700 bg-black p-2 text-sm"
              value={zone.rule.trigger}
              onChange={(event) =>
                onChange({
                  ...zone,
                  rule: {
                    ...zone.rule,
                    trigger: event.target.value as ZoneTriggerType,
                  },
                })
              }
            >
              {ruleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {zone.rule.trigger === "loitering" && (
              <div className="mt-2">
                <label className="text-xs text-gray-400">TIME THRESHOLD (SECONDS)</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="mt-1 w-full rounded border border-gray-700 bg-black p-2 text-sm"
                  value={zone.rule.dwellTime ?? 10}
                  onChange={(event) => {
                    const v = Number.parseInt(event.target.value, 10);
                    onChange({
                      ...zone,
                      rule: {
                        ...zone.rule,
                        dwellTime: Number.isFinite(v) && v > 0 ? v : 10,
                      },
                    });
                  }}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Alert once when a tracked object stays inside the zone continuously for at least this
                  many seconds. Leaving the zone resets the timer.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs text-gray-400">ALERT SEVERITY</label>

            <div className="mt-2 flex gap-2">
              {(["info", "warn", "critical"] as AlertSeverity[]).map((severity) => (
                <button
                  key={severity}
                  type="button"
                  onClick={() =>
                    onChange({
                      ...zone,
                      rule: {
                        ...zone.rule,
                        severity,
                      },
                    })
                  }
                  className={`rounded px-3 py-1 text-xs uppercase ${severityClasses[severity]} ${
                    zone.rule.severity === severity ? "ring-2 ring-white/80" : "opacity-70"
                  }`}
                >
                  {severity}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(zone)}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Save Zone
          </button>
        </div>
      </div>
    </div>
  );
}