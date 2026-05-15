import { Section, StatCard, Badge } from "@/components/ui-bits";
import { useStore } from "@/lib/store";
import { useState } from "react";
import { toast } from "sonner";

export function FieldVisits() {
  const { fieldVisits, members, addFieldVisit, currentUser } = useStore();
  const [memberId, setMemberId] = useState("");
  const [type, setType] = useState<"business" | "home" | "live">("business");
  const [locationNotes, setLocationNotes] = useState("");
  const [lat, setLat] = useState<string>("");
  const [lng, setLng] = useState<string>("");

  const captureGPS = () => {
    if (!navigator.geolocation) return toast.error("GPS not available");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(String(p.coords.latitude));
        setLng(String(p.coords.longitude));
        toast.success("Location captured");
      },
      () => toast.error("Could not capture location"),
    );
  };
  const submit = () => {
    if (!memberId || !locationNotes) return toast.error("Pick a member and add location notes.");
    addFieldVisit({
      memberId,
      type,
      locationNotes,
      lat: lat ? Number(lat) : undefined,
      lng: lng ? Number(lng) : undefined,
      by: currentUser.id,
    });
    toast.success("Visit recorded");
    setLocationNotes("");
    setLat("");
    setLng("");
  };

  // Summary per member
  const directory = members.map((m) => ({
    member: m,
    biz: fieldVisits.find((v) => v.memberId === m.id && v.type === "business"),
    home: fieldVisits.find((v) => v.memberId === m.id && v.type === "home"),
    live: fieldVisits.find((v) => v.memberId === m.id && v.type === "live"),
  }));
  const withCoords = fieldVisits.filter((v) => v.lat && v.lng).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Total Visit Records" value={fieldVisits.length} />
        <StatCard label="Clients With Coordinates" value={withCoords} />
        <StatCard label="Visits With Photos" value={0} />
      </div>

      <Section title="Record Visit">
        <div className="p-5 grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
              Member
            </span>
            <select
              className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
            >
              <option value="">— Select —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} · {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Type</span>
            <select
              className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as any)}
            >
              <option value="business">Business Point</option>
              <option value="home">Home Point</option>
              <option value="live">Live Location</option>
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
              Location notes
            </span>
            <input
              className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
              value={locationNotes}
              onChange={(e) => setLocationNotes(e.target.value)}
              placeholder="e.g. NDENDERU stage, opposite Equity ATM"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
              Latitude
            </span>
            <input
              className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
              Longitude
            </span>
            <input
              className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              onClick={captureGPS}
              className="px-3 py-2 text-sm border border-border rounded-md hover:bg-muted"
            >
              📍 Capture GPS
            </button>
            <button
              onClick={submit}
              className="px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Save Visit
            </button>
          </div>
        </div>
      </Section>

      <Section title="Client Location Directory">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 text-left">Client</th>
                <th className="px-5 py-3 text-left">Phone</th>
                <th className="px-5 py-3 text-left">Business Point</th>
                <th className="px-5 py-3 text-left">Home Point</th>
                <th className="px-5 py-3 text-left">Live</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {directory.map(({ member, biz, home, live }) => (
                <tr key={member.id} className="hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <div className="font-semibold uppercase">{member.name}</div>
                    <div className="text-xs text-muted-foreground">{member.id}</div>
                  </td>
                  <td className="px-5 py-3">{member.phone}</td>
                  <td className="px-5 py-3">
                    {biz ? (
                      <Badge tone="success">Saved</Badge>
                    ) : (
                      <Badge tone="muted">Missing</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {home ? (
                      <Badge tone="success">Saved</Badge>
                    ) : (
                      <Badge tone="muted">Missing</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {live ? (
                      <Badge tone="default">Online</Badge>
                    ) : (
                      <Badge tone="muted">Offline</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
