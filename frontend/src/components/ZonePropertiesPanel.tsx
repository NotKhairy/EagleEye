import type { AlertSeverity, ObjectClass, Zone, ZoneTriggerType } from "../types/types";

type ZonePropertiesPanelProps = {
  isOpen: boolean;
  zone: Zone | null;
  onClose: () => void;
  onChange: (zone: Zone) => void;
  onSave: (zone: Zone) => Promise<void>;
};

const objectOptions: Array<{ value: ObjectClass | "any"; label: string }> = [
  { value: "any", label: "Any Object" },
  { value: "person", label: "Person" },
  { value: "car", label: "Car" },
  { value: "bicycle", label: "Bicycle" },
  { value: "motorcycle", label: "Motorcycle" },
  { value: "bus", label: "Bus" },
  { value: "truck", label: "Truck" },
  { value: "package", label: "Package" },
];

const ruleOptions: Array<{ value: ZoneTriggerType; label: string }> = [
  { value: "enter", label: "Enter Zone" },
  { value: "exit", label: "Exit Zone" },
  { value: "dwell", label: "Stays longer than 10s" },
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
            <label className="text-xs text-gray-400">TRIGGER OBJECT</label>
            <select
              className="mt-1 w-full rounded border border-gray-700 bg-black p-2 text-sm"
              value={zone.rule.objectClass}
              onChange={(event) =>
                onChange({
                  ...zone,
                  rule: {
                    ...zone.rule,
                    objectClass: event.target.value as ObjectClass | "any",
                  },
                })
              }
            >
              {objectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

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