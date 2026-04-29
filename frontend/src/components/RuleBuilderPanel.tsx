import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import type {
  PersonIdentityMode,
  PersonIdentityRule,
  RuleConfig,
  RuleNode,
  PredicateNode,
  ZoneEvent,
  RuleAction,
  RuleObject,
  Zone,
} from "../types/types";
import { COCO_CLASS_NAMES } from "../constants/cocoClasses";
import {
  createPerson,
  listPeople,
  type KnownPerson,
  uploadPersonImages,
} from "../services/api";

type RuleBuilderPanelProps = {
  zones: Zone[];
};

export type RuleBuilderPanelHandle = {
  getRules: () => RuleConfig[];
};

type DraftNode = {
  id: string;
  not: boolean;
  object: RuleObject;
  event: ZoneEvent;
  zoneId: string;
  durationSeconds?: number;
  personFilterEnabled: boolean;
  personIds: string[];
};

type Connector = "AND" | "OR";

const defaultNode = (): DraftNode => ({
  id: crypto.randomUUID(),
  not: false,
  object: "PERSON",
  event: "in_zone",
  zoneId: "",
  durationSeconds: 10,
  personFilterEnabled: false,
  personIds: [],
});

const objectOptions: RuleObject[] = COCO_CLASS_NAMES.map((label) =>
  label.replace(/\s+/g, "_").toUpperCase(),
);

const eventOptions: ZoneEvent[] = ["enter", "exit", "in_zone", "loitering"];

function createPredicate(node: DraftNode): PredicateNode {
  const personIdentity: PersonIdentityRule | undefined =
    node.object === "PERSON" && node.personFilterEnabled
      ? {
          personIds: node.personIds,
        }
      : undefined;

  if (node.event === "enter") {
    return {
      type: "enter",
      object: node.object,
      not: node.not,
      zoneId: node.zoneId,
      personIdentity,
    };
  }

  if (node.event === "exit") {
    return {
      type: "exit",
      object: node.object,
      not: node.not,
      zoneId: node.zoneId,
      personIdentity,
    };
  }

  if (node.event === "loitering") {
    return {
      type: "loitering",
      object: node.object,
      zoneId: node.zoneId,
      durationSeconds: node.durationSeconds ?? 10,
      not: node.not,
      personIdentity,
    };
  }

  return {
    type: "in_zone",
    object: node.object,
    zoneId: node.zoneId,
    not: node.not,
    personIdentity,
  };
}

function composeRuleTree(nodes: DraftNode[], connectors: Connector[]): RuleNode {
  if (nodes.length === 1) {
    return createPredicate(nodes[0]);
  }

  let currentNode: RuleNode = {
    operator: connectors[0],
    children: [createPredicate(nodes[0]), createPredicate(nodes[1])],
  };

  for (let index = 2; index < nodes.length; index += 1) {
    currentNode = {
      operator: connectors[index - 1],
      children: [currentNode, createPredicate(nodes[index])],
    };
  }

  return currentNode;
}

function summarizePredicate(
  node: PredicateNode,
  zoneNameById: Map<string, string>,
  personNameById: Map<string, string>,
): string {
  const notPart = node.not ? "NOT " : "";
  const zoneName = zoneNameById.get(node.zoneId) ?? node.zoneId;
  const personIdentity = node.personIdentity;
  const personFilterSummary = personIdentity && personIdentity.personIds.length > 0
    ? ` [WHITELIST: ${personIdentity.personIds
        .map((personId) => personNameById.get(personId) ?? personId)
        .join(", ")}]`
    : "";

  if (node.type === "loitering") {
    return `${notPart}${node.object} LOITERING IN ${zoneName} FOR ${node.durationSeconds}s${personFilterSummary}`;
  }

  if (node.type === "in_zone") {
    return `${notPart}${node.object} IN ${zoneName}${personFilterSummary}`;
  }

  return `${notPart}${node.object} ${node.type.toUpperCase()} ${zoneName}${personFilterSummary}`;
}

function summarizeRuleNode(
  node: RuleNode,
  zoneNameById: Map<string, string>,
  personNameById: Map<string, string>,
): string {
  if ("type" in node) {
    return summarizePredicate(node, zoneNameById, personNameById);
  }

  if ("child" in node) {
    return `NOT (${summarizeRuleNode(node.child, zoneNameById, personNameById)})`;
  }

  const parts = node.children.map((child) => `(${summarizeRuleNode(child, zoneNameById, personNameById)})`);
  return parts.join(` ${node.operator} `);
}

const RuleBuilderPanel = forwardRef<RuleBuilderPanelHandle, RuleBuilderPanelProps>(function RuleBuilderPanel(
  { zones },
  ref,
) {
  const [rules, setRules] = useState<RuleConfig[]>([]);
  const [ruleName, setRuleName] = useState("");
  const [nodes, setNodes] = useState<DraftNode[]>([defaultNode()]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [actions, setActions] = useState<Record<RuleAction, boolean>>({
    notification: true,
    email: false,
  });
  const [knownPeople, setKnownPeople] = useState<KnownPerson[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [newPersonNameByNode, setNewPersonNameByNode] = useState<Record<string, string>>({});
  const [creatingPersonByNode, setCreatingPersonByNode] = useState<Record<string, boolean>>({});
  const [uploadPersonIdByNode, setUploadPersonIdByNode] = useState<Record<string, string>>({});
  const [uploadFilesByNode, setUploadFilesByNode] = useState<Record<string, File[]>>({});
  const [uploadingByNode, setUploadingByNode] = useState<Record<string, boolean>>({});
  const [uploadStatusByNode, setUploadStatusByNode] = useState<Record<string, string>>({});

  const loadPeople = async () => {
    setPeopleLoading(true);
    setPeopleError(null);
    try {
      const people = await listPeople();
      setKnownPeople(people);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load people";
      setPeopleError(message);
    } finally {
      setPeopleLoading(false);
    }
  };

  useEffect(() => {
    void loadPeople();
  }, []);

  const canCreateRule = useMemo(() => {
    if (!ruleName.trim()) {
      return false;
    }

    if (!actions.notification && !actions.email) {
      return false;
    }

    return nodes.every((node) => {
      if (!node.zoneId.trim()) {
        return false;
      }

      if (node.event === "loitering") {
        return (node.durationSeconds ?? 0) > 0;
      }

      return true;
    });
  }, [actions.email, actions.notification, nodes, ruleName]);

  const addNode = () => {
    setNodes((previous) => {
      const created = defaultNode();
      if (zones.length > 0) {
        created.zoneId = zones[0].id;
      }
      return [...previous, created];
    });
    setConnectors((previous) => [...previous, "AND"]);
  };

  const removeNode = (id: string) => {
    setNodes((previousNodes) => {
      if (previousNodes.length === 1) {
        return previousNodes;
      }

      const removedIndex = previousNodes.findIndex((node) => node.id === id);
      if (removedIndex === -1) {
        return previousNodes;
      }

      setConnectors((previousConnectors) => {
        const next = [...previousConnectors];
        if (removedIndex === 0) {
          next.splice(0, 1);
        } else {
          next.splice(removedIndex - 1, 1);
        }
        return next;
      });

      return previousNodes.filter((node) => node.id !== id);
    });
    setNewPersonNameByNode((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setCreatingPersonByNode((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setUploadPersonIdByNode((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setUploadFilesByNode((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setUploadingByNode((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setUploadStatusByNode((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };

  const updateNode = <K extends keyof DraftNode>(
    nodeId: string,
    key: K,
    value: DraftNode[K],
  ) => {
    setNodes((previous) =>
      previous.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              [key]: value,
            }
          : node,
      ),
    );
  };

  const createRule = () => {
    if (!canCreateRule) {
      return;
    }

    const selectedActions: RuleAction[] = [
      ...(actions.notification ? ["notification" as const] : []),
      ...(actions.email ? ["email" as const] : []),
    ];

    const rule: RuleConfig = {
      id: crypto.randomUUID(),
      name: ruleName.trim(),
      when: composeRuleTree(nodes, connectors),
      actions: selectedActions,
    };

    setRules((previous) => [rule, ...previous]);
    setRuleName("");
    setNodes(() => {
      const resetNode = defaultNode();
      if (zones.length > 0) {
        resetNode.zoneId = zones[0].id;
      }
      return [resetNode];
    });
    setConnectors([]);
    setActions({ notification: true, email: false });
    setNewPersonNameByNode({});
    setCreatingPersonByNode({});
    setUploadPersonIdByNode({});
    setUploadFilesByNode({});
    setUploadingByNode({});
    setUploadStatusByNode({});
  };

  const togglePersonForNode = (nodeId: string, personId: string, checked: boolean) => {
    setNodes((previous) =>
      previous.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }
        const nextPersonIds = checked
          ? Array.from(new Set([...node.personIds, personId]))
          : node.personIds.filter((id) => id !== personId);
        return {
          ...node,
          personIds: nextPersonIds,
        };
      }),
    );
  };

  const handleCreatePerson = async (nodeId: string) => {
    const name = (newPersonNameByNode[nodeId] ?? "").trim();
    if (!name) {
      setUploadStatusByNode((previous) => ({
        ...previous,
        [nodeId]: "Enter a name before creating a person.",
      }));
      return;
    }

    setCreatingPersonByNode((previous) => ({ ...previous, [nodeId]: true }));
    setUploadStatusByNode((previous) => ({ ...previous, [nodeId]: "Creating person..." }));
    try {
      const created = await createPerson(name);
      setKnownPeople((previous) => [created, ...previous]);
      setNodes((previous) =>
        previous.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                personIds: Array.from(new Set([...node.personIds, created.id])),
              }
            : node,
        ),
      );
      setNewPersonNameByNode((previous) => ({ ...previous, [nodeId]: "" }));
      setUploadPersonIdByNode((previous) => ({ ...previous, [nodeId]: created.id }));
      setUploadStatusByNode((previous) => ({
        ...previous,
        [nodeId]: `Created ${created.name}. Upload photos to complete enrollment.`,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create person";
      setUploadStatusByNode((previous) => ({ ...previous, [nodeId]: message }));
    } finally {
      setCreatingPersonByNode((previous) => ({ ...previous, [nodeId]: false }));
    }
  };

  const handleUploadImages = async (nodeId: string) => {
    const personId = uploadPersonIdByNode[nodeId] || "";
    const files = uploadFilesByNode[nodeId] || [];
    if (!personId || files.length === 0) {
      setUploadStatusByNode((previous) => ({
        ...previous,
        [nodeId]: "Select a person and at least one image.",
      }));
      return;
    }

    setUploadingByNode((previous) => ({ ...previous, [nodeId]: true }));
    setUploadStatusByNode((previous) => ({ ...previous, [nodeId]: "Uploading and enrolling images..." }));
    try {
      await uploadPersonImages(personId, files);
      setUploadFilesByNode((previous) => ({ ...previous, [nodeId]: [] }));
      setUploadStatusByNode((previous) => ({
        ...previous,
        [nodeId]: `Enrollment updated with ${files.length} image(s).`,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upload images";
      setUploadStatusByNode((previous) => ({ ...previous, [nodeId]: message }));
    } finally {
      setUploadingByNode((previous) => ({ ...previous, [nodeId]: false }));
    }
  };

  const zoneNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const zone of zones) {
      map.set(zone.id, zone.name);
    }
    return map;
  }, [zones]);

  const personNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of knownPeople) {
      map.set(person.id, person.name);
    }
    return map;
  }, [knownPeople]);

  useEffect(() => {
    if (zones.length === 0) {
      return;
    }

    setNodes((previous) =>
      previous.map((node) =>
        node.zoneId
          ? node
          : {
              ...node,
              zoneId: zones[0].id,
            },
      ),
    );
  }, [zones]);

  const deleteRule = (ruleId: string) => {
    setRules((previous) => previous.filter((rule) => rule.id !== ruleId));
  };

  useImperativeHandle(ref, () => ({
    getRules: () => rules,
  }), [rules]);

  return (
    <div className="bg-[#11161D] p-3 rounded-lg space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-sm">Rule Builder</h3>
          <p className="text-[11px] leading-4 text-gray-400">
            Build composite rules using unlimited condition nodes.
          </p>
        </div>
        <span className="text-[11px] px-2 py-1 rounded bg-black border border-gray-700 text-gray-300">
          {rules.length} saved
        </span>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-gray-400" htmlFor="ruleName">
          Rule Name
        </label>
        <input
          id="ruleName"
          value={ruleName}
          onChange={(event) => setRuleName(event.target.value)}
          className="w-full bg-black border border-gray-700 rounded p-2 text-sm"
          placeholder="Example: Person in Zone1 with car in Zone2"
        />
        <div className="flex items-center justify-between text-[11px] text-gray-400">
          <span>
            {peopleLoading
              ? "Loading identities..."
              : `Known identities: ${knownPeople.length}`}
          </span>
          <button
            type="button"
            onClick={() => {
              void loadPeople();
            }}
            className="px-2 py-1 rounded border border-gray-700 hover:border-blue-500 hover:text-blue-300"
            disabled={peopleLoading}
          >
            Refresh
          </button>
        </div>
        {peopleError ? <p className="text-[11px] text-red-300">{peopleError}</p> : null}
      </div>

      <div className="space-y-2">
        {nodes.map((node, index) => (
          <div key={node.id} className="space-y-2">
            {index > 0 ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400">Connector</span>
                <select
                  className="bg-black border border-gray-700 rounded px-2 py-1 text-xs"
                  value={connectors[index - 1]}
                  onChange={(event) => {
                    const next = [...connectors];
                    next[index - 1] = event.target.value as Connector;
                    setConnectors(next);
                  }}
                >
                  <option value="AND">AND</option>
                  <option value="OR">OR</option>
                </select>
              </div>
            ) : null}

            <div className="border border-gray-700 rounded p-2 bg-[#0B0F14] grid grid-cols-2 gap-2">
              <label className="flex items-center gap-1 text-xs text-gray-300 col-span-2">
                <input
                  type="checkbox"
                  checked={node.not}
                  onChange={(event) => updateNode(node.id, "not", event.target.checked)}
                />
                NOT (optional)
              </label>

              <div>
                <label className="text-[11px] text-gray-400">Object</label>
                <select
                  className="w-full mt-1 bg-black border border-gray-700 rounded p-1.5 text-xs"
                  value={node.object}
                  onChange={(event) =>
                    updateNode(node.id, "object", event.target.value as RuleObject)
                  }
                >
                  {objectOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] text-gray-400">Condition</label>
                <select
                  className="w-full mt-1 bg-black border border-gray-700 rounded p-1.5 text-xs"
                  value={node.event}
                  onChange={(event) =>
                    updateNode(node.id, "event", event.target.value as ZoneEvent)
                  }
                >
                  {eventOptions.map((option) => (
                    <option key={option} value={option}>
                      {option.replace("_", " ").toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] text-gray-400">Zone</label>
                <select
                  className="w-full mt-1 bg-black border border-gray-700 rounded p-1.5 text-xs"
                  value={node.zoneId}
                  onChange={(event) => updateNode(node.id, "zoneId", event.target.value)}
                  disabled={zones.length === 0}
                >
                  <option value="">
                    {zones.length === 0 ? "No zones available" : "Select a zone"}
                  </option>
                  {zones.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
                </select>
              </div>

              {node.event === "loitering" ? (
                <div>
                  <label className="text-[11px] text-gray-400">Duration (sec)</label>
                  <input
                    type="number"
                    min={1}
                    className="w-full mt-1 bg-black border border-gray-700 rounded p-1.5 text-xs"
                    value={node.durationSeconds ?? 10}
                    onChange={(event) =>
                      updateNode(node.id, "durationSeconds", Number(event.target.value))
                    }
                  />
                </div>
              ) : null}

              {node.object === "PERSON" ? (
                <div className="col-span-2 border border-gray-700 rounded p-2 bg-black/40 space-y-2">
                  <label className="flex items-center gap-2 text-xs text-gray-200">
                    <input
                      type="checkbox"
                      checked={node.personFilterEnabled}
                      onChange={(event) =>
                        updateNode(node.id, "personFilterEnabled", event.target.checked)
                      }
                    />
                    Ignore whitelisted people for this condition
                  </label>

                  {node.personFilterEnabled ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] text-gray-400">Selected identities</label>
                          <p className="text-[11px] mt-1 text-gray-300">
                            {node.personIds.length === 0
                              ? "None selected"
                              : node.personIds
                                  .map((personId) => personNameById.get(personId) ?? personId)
                                  .join(", ")}
                          </p>
                        </div>
                        <div>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <p className="text-[11px] text-gray-400">Choose people</p>
                        {knownPeople.length === 0 ? (
                          <p className="text-[11px] text-amber-300">
                            No enrolled people yet. Create one and upload photos below.
                          </p>
                        ) : (
                          <div className="max-h-28 overflow-y-auto pr-1 grid grid-cols-2 gap-1">
                            {knownPeople.map((person) => (
                              <label
                                key={person.id}
                                className="text-[11px] text-gray-300 flex items-center gap-1"
                              >
                                <input
                                  type="checkbox"
                                  checked={node.personIds.includes(person.id)}
                                  onChange={(event) =>
                                    togglePersonForNode(node.id, person.id, event.target.checked)
                                  }
                                />
                                {person.name}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="border border-gray-700 rounded p-2 space-y-2">
                        <p className="text-[11px] text-gray-300">Create person and attach photos</p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="New person name"
                            className="flex-1 bg-black border border-gray-700 rounded p-1.5 text-xs"
                            value={newPersonNameByNode[node.id] ?? ""}
                            onChange={(event) =>
                              setNewPersonNameByNode((previous) => ({
                                ...previous,
                                [node.id]: event.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            className="px-2 py-1 text-xs rounded border border-blue-500/60 text-blue-300 disabled:opacity-50"
                            onClick={() => {
                              void handleCreatePerson(node.id);
                            }}
                            disabled={creatingPersonByNode[node.id]}
                          >
                            {creatingPersonByNode[node.id] ? "Creating..." : "Create"}
                          </button>
                        </div>

                        <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                          <select
                            className="bg-black border border-gray-700 rounded p-1.5 text-xs"
                            value={uploadPersonIdByNode[node.id] ?? ""}
                            onChange={(event) =>
                              setUploadPersonIdByNode((previous) => ({
                                ...previous,
                                [node.id]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Select person for photo upload</option>
                            {knownPeople.map((person) => (
                              <option key={person.id} value={person.id}>
                                {person.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="px-2 py-1 text-xs rounded border border-green-500/60 text-green-300 disabled:opacity-50"
                            onClick={() => {
                              void handleUploadImages(node.id);
                            }}
                            disabled={uploadingByNode[node.id]}
                          >
                            {uploadingByNode[node.id] ? "Uploading..." : "Upload"}
                          </button>
                        </div>

                        <input
                          type="file"
                          multiple
                          accept="image/*"
                          className="w-full text-[11px] text-gray-300"
                          onChange={(event) => {
                            const selectedFiles = Array.from(event.target.files || []);
                            setUploadFilesByNode((previous) => ({
                              ...previous,
                              [node.id]: selectedFiles,
                            }));
                          }}
                        />

                        {(uploadFilesByNode[node.id] ?? []).length > 0 ? (
                          <p className="text-[11px] text-gray-400">
                            {(uploadFilesByNode[node.id] ?? []).length} image(s) selected.
                          </p>
                        ) : null}

                        {uploadStatusByNode[node.id] ? (
                          <p className="text-[11px] text-gray-300">{uploadStatusByNode[node.id]}</p>
                        ) : null}

                        {node.personIds.length === 0 ? (
                          <p className="text-[11px] text-amber-300">
                            Whitelist is empty, so this condition will trigger for every person.
                          </p>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}

              <div className="col-span-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeNode(node.id)}
                  disabled={nodes.length === 1}
                  className="text-xs px-2 py-1 rounded border border-red-500/50 text-red-300 disabled:opacity-40"
                >
                  Remove Node
                </button>
              </div>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addNode}
          className="w-full text-xs border border-dashed border-gray-600 rounded py-2 hover:border-blue-500 hover:text-blue-300"
        >
          + Add Node
        </button>
      </div>

      <div>
        <p className="text-xs text-gray-400 mb-1">Actions</p>
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={actions.notification}
              onChange={(event) =>
                setActions((previous) => ({
                  ...previous,
                  notification: event.target.checked,
                }))
              }
            />
            Notification
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={actions.email}
              onChange={(event) =>
                setActions((previous) => ({
                  ...previous,
                  email: event.target.checked,
                }))
              }
            />
            Email
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={createRule}
          disabled={!canCreateRule}
          className="px-3 py-2 rounded text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
        >
          Create Rule
        </button>
        {!canCreateRule ? (
          <p className="text-[11px] text-gray-500">
            Add a name, valid nodes with selected zones, and at least one action.
          </p>
        ) : null}
      </div>

      {zones.length === 0 ? (
        <p className="text-[11px] text-amber-300">
          Draw at least one zone on the canvas before creating rules.
        </p>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs text-gray-400">Current Rules</p>
        {rules.length === 0 ? (
          <div className="text-xs text-gray-500 border border-gray-700 rounded p-2 bg-black">
            No rules created yet.
          </div>
        ) : (
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="border border-gray-700 rounded p-2 bg-black text-xs space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-sm text-gray-200">{rule.name}</p>
                  <button
                    type="button"
                    onClick={() => deleteRule(rule.id)}
                    className="text-red-300 border border-red-500/50 rounded px-2 py-1 hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                </div>
                <p className="text-gray-400">
                  {summarizeRuleNode(rule.when, zoneNameById, personNameById)}
                </p>
                <p className="text-gray-500">Actions: {rule.actions.join(", ")}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export default RuleBuilderPanel;
