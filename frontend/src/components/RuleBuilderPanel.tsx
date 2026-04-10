import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import type {
  RuleConfig,
  RuleNode,
  PredicateNode,
  ZoneEvent,
  RuleAction,
  RuleObject,
  Zone,
} from "../types/types";
import { COCO_CLASS_NAMES } from "../constants/cocoClasses";

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
};

type Connector = "AND" | "OR";

const defaultNode = (): DraftNode => ({
  id: crypto.randomUUID(),
  not: false,
  object: "PERSON",
  event: "in_zone",
  zoneId: "",
  durationSeconds: 10,
});

const objectOptions: RuleObject[] = COCO_CLASS_NAMES.map((label) =>
  label.replace(/\s+/g, "_").toUpperCase(),
);

const eventOptions: ZoneEvent[] = ["enter", "exit", "in_zone", "loitering"];

function createPredicate(node: DraftNode): PredicateNode {
  if (node.event === "enter") {
    return {
      type: "enter",
      object: node.object,
      not: node.not,
      zoneId: node.zoneId,
    };
  }

  if (node.event === "exit") {
    return {
      type: "exit",
      object: node.object,
      not: node.not,
      zoneId: node.zoneId,
    };
  }

  if (node.event === "loitering") {
    return {
      type: "loitering",
      object: node.object,
      zoneId: node.zoneId,
      durationSeconds: node.durationSeconds ?? 10,
      not: node.not,
    };
  }

  return {
    type: "in_zone",
    object: node.object,
    zoneId: node.zoneId,
    not: node.not,
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

function summarizePredicate(node: PredicateNode, zoneNameById: Map<string, string>): string {
  const notPart = node.not ? "NOT " : "";
  const zoneName = zoneNameById.get(node.zoneId) ?? node.zoneId;

  if (node.type === "loitering") {
    return `${notPart}${node.object} LOITERING IN ${zoneName} FOR ${node.durationSeconds}s`;
  }

  if (node.type === "in_zone") {
    return `${notPart}${node.object} IN ${zoneName}`;
  }

  return `${notPart}${node.object} ${node.type.toUpperCase()} ${zoneName}`;
}

function summarizeRuleNode(node: RuleNode, zoneNameById: Map<string, string>): string {
  if ("type" in node) {
    return summarizePredicate(node, zoneNameById);
  }

  if ("child" in node) {
    return `NOT (${summarizeRuleNode(node.child, zoneNameById)})`;
  }

  const parts = node.children.map((child) => `(${summarizeRuleNode(child, zoneNameById)})`);
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
  };

  const zoneNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const zone of zones) {
      map.set(zone.id, zone.name);
    }
    return map;
  }, [zones]);

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
                  {summarizeRuleNode(rule.when, zoneNameById)}
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
