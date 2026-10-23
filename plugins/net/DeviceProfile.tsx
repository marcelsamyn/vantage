import "./net.css";
import { Check, Copy } from "lucide-react";
import { useState, type ReactElement } from "react";
import type { ProfilerProps } from "../../app/core/plugin";
import { Button, ProfilerCard, Tag } from "../../app/ui";
import { KIND_LABEL, deviceTitle } from "./labels";

/** Profiler for a device on the local network. Everything shown was read from this network or the Mac itself. */
export default function DeviceProfile({ entity, onClose }: ProfilerProps<"device">): ReactElement {
  const d = entity.data;
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard.writeText(d.ip).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <ProfilerCard
      key={d.id}
      band="Device on your network"
      name={deviceTitle(d)}
      kicker={[KIND_LABEL[d.kind], d.vendor].filter(Boolean).join(" · ")}
      tone="ice"
      onClose={onClose}
      rows={[
        ["IP address", d.ip],
        ["MAC address", d.mac],
        d.randomized && ["Address type", "Private Wi-Fi address"],
        d.vendor && ["Vendor", d.vendor],
        d.model && ["Model", d.model],
        d.services.length > 0 && [
          "Announces",
          <span key="services" className="net-tags">
            {d.services.map((s) => (
              <Tag key={s}>{s}</Tag>
            ))}
          </span>,
        ],
        (d.isGateway || d.isThisMac) && ["Role", d.isThisMac ? "This Mac" : "Default gateway"],
      ]}
      fact={d.note ?? undefined}
      actions={
        <Button size="sm" icon={copied ? <Check size={13} /> : <Copy size={13} />} onClick={copy}>
          {copied ? "Copied" : "Copy IP"}
        </Button>
      }
      source="ARP cache · Bonjour · IEEE vendor registry"
    />
  );
}
