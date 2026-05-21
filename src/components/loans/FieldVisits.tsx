import { useMemo, useState, type ChangeEvent } from "react";
import { Camera, ExternalLink, MapPinned, Navigation, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Section, StatCard, Badge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type FieldVisit, useStore } from "@/lib/store";

type VisitType = "business" | "home" | "live";
type PendingCoords = { lat: number; lng: number; accuracy?: number };
type PhotoDraft = {
  id: string;
  name: string;
  size: number;
  label: string;
  data: string;
};

const MAX_VISIT_PHOTOS = 6;
const PHOTO_LABEL_OPTIONS = [
  "Main Gate",
  "While seated in the house",
  "Kitchen",
  "Full house view",
  "Opposite to",
  "On the left",
  "On the right",
  "Main street",
  "Near landmark",
  "Other",
];

const VISIT_LABEL: Record<VisitType, string> = {
  business: "Business Point",
  home: "Home Point",
  live: "Live Location",
};

function mapPlaceUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function mapDirectionsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function openExternalMap(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function formatCoord(value?: number) {
  return value == null ? "-" : value.toFixed(6);
}

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function imageFileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error(`Could not process ${file.name}.`));
      image.onload = () => {
        const maxEdge = 1280;
        const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Image compression is not available on this device."));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.76));
      };
      image.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
  });
}

export function FieldVisits() {
  const { fieldVisits, members, addFieldVisit, currentUser } = useStore();
  const [memberId, setMemberId] = useState("");
  const [type, setType] = useState<VisitType>("business");
  const [locationNotes, setLocationNotes] = useState("");
  const [lat, setLat] = useState<string>("");
  const [lng, setLng] = useState<string>("");
  const [supportingPhotos, setSupportingPhotos] = useState<PhotoDraft[]>([]);
  const [pendingCoords, setPendingCoords] = useState<PendingCoords | null>(null);
  const [gpsDialogOpen, setGpsDialogOpen] = useState(false);
  const [isCapturingGps, setIsCapturingGps] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const directory = useMemo(
    () =>
      members.map((member) => ({
        member,
        biz: fieldVisits.find((visit) => visit.memberId === member.id && visit.type === "business"),
        home: fieldVisits.find((visit) => visit.memberId === member.id && visit.type === "home"),
        live: fieldVisits.find((visit) => visit.memberId === member.id && visit.type === "live"),
      })),
    [fieldVisits, members],
  );

  const withCoords = fieldVisits.filter((visit) => visit.lat != null && visit.lng != null).length;
  const visitsWithPhotos = fieldVisits.filter((visit) => (visit.photos?.length ?? 0) > 0).length;
  const totalSavedPhotos = fieldVisits.reduce((sum, visit) => sum + (visit.photos?.length ?? 0), 0);

  async function captureGPS() {
    if (!navigator.geolocation) {
      toast.error("GPS is not available on this device.");
      return;
    }

    setIsCapturingGps(true);
    let mapWindow: Window | null = null;
    try {
      mapWindow = window.open("", "_blank");
    } catch {
      mapWindow = null;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsCapturingGps(false);
        const nextCoords = {
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
          accuracy: position.coords.accuracy,
        };
        setPendingCoords(nextCoords);
        setGpsDialogOpen(true);
        const url = mapPlaceUrl(nextCoords.lat, nextCoords.lng);
        if (mapWindow && !mapWindow.closed) mapWindow.location.href = url;
        else openExternalMap(url);
        toast.success("Google Maps opened. Confirm the pin, then tap Use this location.");
      },
      (error) => {
        setIsCapturingGps(false);
        if (mapWindow && !mapWindow.closed) mapWindow.close();
        const message =
          error.code === 1
            ? "Location access was denied."
            : error.code === 3
              ? "Location request timed out."
              : "Could not capture location.";
        toast.error(message);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  }

  function acceptPendingCoords() {
    if (!pendingCoords) return;
    setLat(String(pendingCoords.lat));
    setLng(String(pendingCoords.lng));
    setGpsDialogOpen(false);
    toast.success("GPS coordinates added to this visit.");
  }

  async function handlePhotoSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (supportingPhotos.length >= MAX_VISIT_PHOTOS) {
      toast.error(`A visit can hold up to ${MAX_VISIT_PHOTOS} photos.`);
      return;
    }
    if (supportingPhotos.length + files.length > MAX_VISIT_PHOTOS) {
      toast.error(
        `Add up to ${MAX_VISIT_PHOTOS - supportingPhotos.length} more photo(s) for this visit.`,
      );
      return;
    }

    try {
      const nextPhotos = await Promise.all(
        files.map(async (file, index) => {
          if (!file.type.startsWith("image/")) {
            throw new Error(`"${file.name}" is not an image.`);
          }
          const data = await imageFileToDataUrl(file);
          return {
            id: `${Date.now()}-${index}-${file.name}`,
            name: file.name,
            size: file.size,
            label: "",
            data,
          };
        }),
      );
      setSupportingPhotos((current) => [...current, ...nextPhotos]);
      toast.success(`${nextPhotos.length} supporting photo(s) added.`);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not add the selected photo.");
    }
  }

  function removePhoto(photoId: string) {
    setSupportingPhotos((current) => current.filter((photo) => photo.id !== photoId));
  }

  async function submit() {
    if (!memberId) {
      toast.error("Pick a member before saving the visit.");
      return;
    }
    if (!locationNotes.trim()) {
      toast.error("Add supporting notes or a landmark description.");
      return;
    }
    if ((lat && !lng) || (!lat && lng)) {
      toast.error("Latitude and longitude must both be filled.");
      return;
    }
    if (supportingPhotos.some((photo) => !photo.label.trim())) {
      toast.error("Please add a description or category for every selected photo.");
      return;
    }

    setIsSaving(true);
    try {
      await addFieldVisit({
        memberId,
        type,
        locationNotes: locationNotes.trim(),
        lat: lat ? Number(lat) : undefined,
        lng: lng ? Number(lng) : undefined,
        photos: supportingPhotos.map((photo) => photo.data),
        photoLabels: supportingPhotos.map((photo) => photo.label.trim()),
        by: currentUser.id,
      });
      toast.success("Field visit saved to the database.");
      setLocationNotes("");
      setLat("");
      setLng("");
      setSupportingPhotos([]);
      setPendingCoords(null);
      setGpsDialogOpen(false);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not save the field visit.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Dialog open={gpsDialogOpen} onOpenChange={setGpsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm GPS location</DialogTitle>
            <DialogDescription>
              Google Maps has been opened so you can verify the pin before saving it with this field
              visit.
            </DialogDescription>
          </DialogHeader>
          {pendingCoords && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Latitude
                  </div>
                  <div className="font-mono mt-1">{formatCoord(pendingCoords.lat)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Longitude
                  </div>
                  <div className="font-mono mt-1">{formatCoord(pendingCoords.lng)}</div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Accuracy: about {Math.max(1, Math.round(pendingCoords.accuracy ?? 0))} meters
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                pendingCoords && openExternalMap(mapPlaceUrl(pendingCoords.lat, pendingCoords.lng))
              }
            >
              Open Google Maps Again
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setGpsDialogOpen(false);
                void captureGPS();
              }}
            >
              Capture Again
            </Button>
            <Button type="button" onClick={acceptPendingCoords}>
              Use This Location
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatCard label="Total Visit Records" value={fieldVisits.length} />
          <StatCard label="Clients With Coordinates" value={withCoords} />
          <StatCard
            label="Visits With Photos"
            value={visitsWithPhotos}
            hint={`${totalSavedPhotos} supporting photo(s) saved`}
          />
        </div>

        <Section title="Record Visit">
          <div className="grid gap-4 p-5 md:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Member
              </span>
              <select
                className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
              >
                <option value="">Select member</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.id} - {member.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Type
              </span>
              <select
                className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                value={type}
                onChange={(event) => setType(event.target.value as VisitType)}
              >
                <option value="business">Business Point</option>
                <option value="home">Home Point</option>
                <option value="live">Live Location</option>
              </select>
            </label>

            <label className="block md:col-span-2">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Supporting notes / landmark
              </span>
              <input
                className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                value={locationNotes}
                onChange={(event) => setLocationNotes(event.target.value)}
                placeholder="e.g. opposite Equity ATM, blue gate, second floor"
              />
            </label>

            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Latitude
              </span>
              <input
                className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm font-mono"
                value={lat}
                onChange={(event) => setLat(event.target.value)}
                placeholder="-1.283253"
              />
            </label>

            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Longitude
              </span>
              <input
                className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm font-mono"
                value={lng}
                onChange={(event) => setLng(event.target.value)}
                placeholder="36.816670"
              />
            </label>

            <div className="flex items-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void captureGPS()}
                disabled={isCapturingGps}
              >
                <MapPinned className="h-4 w-4" />
                {isCapturingGps ? "Capturing..." : "Capture GPS"}
              </Button>
              {(lat || lng) && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setLat("");
                    setLng("");
                    setPendingCoords(null);
                  }}
                >
                  Clear
                </Button>
              )}
            </div>

            <div className="lg:col-span-4">
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-medium">Supporting photos</div>
                    <div className="text-xs text-muted-foreground">
                      Add up to {MAX_VISIT_PHOTOS} photos before saving this field visit. Use labels
                      like Main Gate, Kitchen, Full house view, Opposite to, On the left, On the
                      right, Main street, or Near landmark.
                    </div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted">
                    <Camera className="h-4 w-4" />
                    Add Photos
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handlePhotoSelection}
                    />
                  </label>
                </div>

                {supportingPhotos.length > 0 && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {supportingPhotos.map((photo) => {
                      return (
                        <div
                          key={photo.id}
                          className="overflow-hidden rounded-lg border border-border bg-background"
                        >
                          <img
                            src={photo.data}
                            alt={photo.name}
                            className="h-32 w-full object-cover"
                          />
                          <div className="space-y-2 p-3">
                            <div className="space-y-2 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="truncate text-sm font-medium">{photo.name}</div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removePhoto(photo.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Remove
                                </Button>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatBytes(photo.size)}
                              </div>
                              <label className="block">
                                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                  Photo description
                                </span>
                                <input
                                  list="photo-label-options"
                                  className="mt-1 w-full rounded-md border border-border bg-muted px-2 py-2 text-sm"
                                  value={photo.label}
                                  onChange={(event) => {
                                    const nextLabel = event.target.value;
                                    setSupportingPhotos((current) =>
                                      current.map((item) =>
                                        item.id === photo.id ? { ...item, label: nextLabel } : item,
                                      ),
                                    );
                                  }}
                                  placeholder="e.g. Main Gate"
                                />
                                <datalist id="photo-label-options">
                                  {PHOTO_LABEL_OPTIONS.map((option) => (
                                    <option key={option} value={option} />
                                  ))}
                                </datalist>
                              </label>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-4 flex flex-wrap justify-end gap-2">
              <Button type="button" onClick={() => void submit()} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Visit"}
              </Button>
            </div>
          </div>
        </Section>

        <Section title="Client Location Directory">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
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
                  <tr key={member.id} className="align-top hover:bg-muted/30">
                    <td className="px-5 py-4">
                      <div className="font-semibold uppercase">{member.name}</div>
                      <div className="text-xs text-muted-foreground">{member.id}</div>
                    </td>
                    <td className="px-5 py-4">{member.phone}</td>
                    <td className="px-5 py-4">
                      <VisitLocationCell memberName={member.name} label="business" visit={biz} />
                    </td>
                    <td className="px-5 py-4">
                      <VisitLocationCell memberName={member.name} label="home" visit={home} />
                    </td>
                    <td className="px-5 py-4">
                      <VisitLocationCell memberName={member.name} label="live" visit={live} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}

function VisitLocationCell({
  memberName,
  label,
  visit,
}: {
  memberName: string;
  label: VisitType;
  visit?: FieldVisit;
}) {
  if (!visit) return <Badge tone="muted">Missing</Badge>;

  const hasCoords = visit.lat != null && visit.lng != null;
  const photoCount = visit.photos?.length ?? 0;

  return (
    <div className="min-w-[210px] space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={label === "live" ? "default" : "success"}>Saved</Badge>
        <span className="text-[11px] text-muted-foreground">{visit.date}</span>
      </div>

      <div className="text-xs font-medium">{VISIT_LABEL[label]}</div>

      <button
        type="button"
        className="text-left text-sm text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
        disabled={!hasCoords}
        onClick={() => hasCoords && openExternalMap(mapPlaceUrl(visit.lat!, visit.lng!))}
      >
        Open {memberName} {label} location
      </button>

      <div className="text-xs leading-5 text-muted-foreground">
        {visit.locationNotes || "No supporting notes recorded."}
      </div>

      <div className="font-mono text-[11px] text-muted-foreground">
        {formatCoord(visit.lat)}, {formatCoord(visit.lng)}
      </div>

      <div className="flex flex-wrap gap-2">
        {hasCoords ? (
          <>
            <a
              href={mapPlaceUrl(visit.lat!, visit.lng!)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
            >
              <ExternalLink className="h-3 w-3" />
              Map
            </a>
            <a
              href={mapDirectionsUrl(visit.lat!, visit.lng!)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
            >
              <Navigation className="h-3 w-3" />
              Directions
            </a>
          </>
        ) : (
          <Badge tone="warning">GPS not saved</Badge>
        )}
        {photoCount > 0 && <Badge tone="accent">{photoCount} photo(s)</Badge>}
      </div>

      {photoCount > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {visit.photos!.slice(0, 4).map((photo, index) => {
            const labelText = visit.photoLabels?.[index];
            return (
              <a
                key={`${visit.id}-photo-${index}`}
                href={photo}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0"
              >
                <div className="flex flex-col items-center gap-1">
                  <img
                    src={photo}
                    alt={labelText || `${memberName} ${label} evidence ${index + 1}`}
                    className="h-12 w-12 rounded-md border border-border object-cover"
                  />
                  {labelText ? (
                    <div className="max-w-[80px] text-[10px] text-center text-muted-foreground">
                      {labelText}
                    </div>
                  ) : null}
                </div>
              </a>
            );
          })}
          {photoCount > 4 && (
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-border bg-muted text-[11px] text-muted-foreground">
              +{photoCount - 4}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
