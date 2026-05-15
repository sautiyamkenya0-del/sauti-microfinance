import { createFileRoute, Navigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section } from "@/components/ui-bits";
import { useStore, roleLabel, type Role, type Staff } from "@/lib/store";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Camera, KeyRound, Trash2, UserPlus, Pencil } from "lucide-react";
import { StaffFormDialog } from "@/components/StaffFormDialog";

export const Route = createFileRoute("/staff-mgmt")({
  head: () => ({ meta: [{ title: "Staff Management — Sauti Microfinance" }] }),
  component: StaffMgmt,
});

type Memo = { id: string; date: string; title: string; body: string; by: string };
type StaffMeta = { photo?: string; pin?: string; phone?: string; email?: string };
const PHOTO_KEY = "sauti_staff_meta_v1";
const MEMO_KEY = "sauti_memos_v1";
const NEW_STAFF_KEY = "sauti_extra_staff_v1";

function StaffMgmt() {
  const { currentUser, staff, attendance, removeStaff, updateStaff } = useStore();
  const [staffDialog, setStaffDialog] = useState<{ open: boolean; editing?: Staff }>({
    open: false,
  });

  const [meta, setMeta] = useState<Record<string, StaffMeta>>(() => {
    try {
      return JSON.parse(localStorage.getItem(PHOTO_KEY) ?? "{}");
    } catch {
      return {};
    }
  });
  const [memos, setMemos] = useState<Memo[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(MEMO_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const [extra, setExtra] = useState<{ id: string; name: string; role: Role }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(NEW_STAFF_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    localStorage.setItem(PHOTO_KEY, JSON.stringify(meta));
  }, [meta]);
  useEffect(() => {
    localStorage.setItem(MEMO_KEY, JSON.stringify(memos));
  }, [memos]);
  useEffect(() => {
    localStorage.setItem(NEW_STAFF_KEY, JSON.stringify(extra));
  }, [extra]);

  const allStaff = [...staff, ...extra];

  const [memoTitle, setMemoTitle] = useState("");
  const [memoBody, setMemoBody] = useState("");

  if (currentUser.role !== "director") return <Navigate to="/" />;

  function resetPassword(s: Staff) {
    const newPwd = "Sauti" + Math.floor(1000 + Math.random() * 9000);
    updateStaff(s.id, { tempPassword: newPwd });
    toast.success(`New password for ${s.name}: ${newPwd}`);
  }
  function uploadPhoto(staffId: string, file: File) {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = r.result as string;
      if (staff.find((x) => x.id === staffId)) updateStaff(staffId, { photo: dataUrl });
      else setMeta((p) => ({ ...p, [staffId]: { ...p[staffId], photo: dataUrl } }));
    };
    r.readAsDataURL(file);
  }
  function resetPin(staffId: string) {
    const newPin = String(Math.floor(1000 + Math.random() * 9000));
    setMeta((p) => ({ ...p, [staffId]: { ...p[staffId], pin: newPin } }));
    toast.success(`New PIN for ${staffId}: ${newPin}`);
  }
  function postMemo() {
    if (!memoTitle.trim() || !memoBody.trim()) return;
    setMemos((p) => [
      {
        id: `MM${Date.now()}`,
        date: new Date().toISOString().slice(0, 10),
        title: memoTitle,
        body: memoBody,
        by: currentUser.name,
      },
      ...p,
    ]);
    setMemoTitle("");
    setMemoBody("");
    toast.success("Memo posted to all staff");
  }

  const todayAtt = attendance.filter((a) => a.date === new Date().toISOString().slice(0, 10));

  return (
    <>
      <AppHeader
        title="Staff Management"
        subtitle="Director-only — onboard staff, manage profiles & PINs, post memos, monitor attendance."
      />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <SectionTabs section="admin" />
        <div className="grid lg:grid-cols-3 gap-6">
          <Section title="Add Staff">
            <div className="p-5 space-y-3">
              <p className="text-sm text-muted-foreground">
                Onboard a new staff member with photo, role, and a temporary password they can sign
                in with right away.
              </p>
              <button
                onClick={() => setStaffDialog({ open: true })}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
              >
                <UserPlus className="h-4 w-4" />
                Add a new staff member
              </button>
            </div>
          </Section>

          <Section title="Post Memo">
            <div className="p-5 space-y-3">
              <input
                value={memoTitle}
                onChange={(e) => setMemoTitle(e.target.value)}
                placeholder="Memo title"
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              />
              <textarea
                value={memoBody}
                onChange={(e) => setMemoBody(e.target.value)}
                placeholder="Write a memo to all staff…"
                rows={5}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              />
              <button
                onClick={postMemo}
                className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
              >
                Post Memo
              </button>
            </div>
          </Section>

          <Section title="Today's Attendance">
            <div className="p-5 space-y-2 text-sm">
              {todayAtt.length === 0 && (
                <div className="text-muted-foreground">No check-ins yet today.</div>
              )}
              {todayAtt.map((a) => {
                const s = allStaff.find((x) => x.id === a.staffId);
                return (
                  <div key={a.id} className="flex justify-between border-b border-border pb-1.5">
                    <span>{s?.name ?? a.staffId}</span>
                    <span
                      className={`text-xs uppercase ${a.status === "present" ? "text-success" : a.status === "late" ? "text-accent" : "text-destructive"}`}
                    >
                      {a.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        <Section title={`Staff Roster (${allStaff.length})`}>
          <div className="p-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {allStaff.map((s) => {
              const m = meta[s.id] ?? {};
              const photoSrc = (s as Staff).photo ?? m.photo;
              const phoneStr = (s as Staff).phone ?? m.phone;
              const isStoreStaff = !!staff.find((x) => x.id === s.id);
              return (
                <div key={s.id} className="bg-muted/40 border border-border rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      {photoSrc ? (
                        <img
                          src={photoSrc}
                          alt={s.name}
                          className="h-14 w-14 rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-14 w-14 rounded-full bg-primary text-primary-foreground grid place-items-center font-semibold">
                          {s.name[0]}
                        </div>
                      )}
                      <label className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-card border border-border grid place-items-center cursor-pointer hover:bg-muted">
                        <Camera className="h-3 w-3" />
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) =>
                            e.target.files?.[0] && uploadPhoto(s.id, e.target.files[0])
                          }
                        />
                      </label>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{s.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {roleLabel(s.role)} · {s.id}
                      </div>
                      {phoneStr && (
                        <div className="text-xs text-muted-foreground truncate">{phoneStr}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {isStoreStaff && (
                      <button
                        onClick={() => setStaffDialog({ open: true, editing: s as Staff })}
                        className="flex-1 inline-flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md bg-card border border-border hover:bg-muted"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                    )}
                    {isStoreStaff ? (
                      <button
                        onClick={() => resetPassword(s as Staff)}
                        className="flex-1 inline-flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md bg-card border border-border hover:bg-muted"
                      >
                        <KeyRound className="h-3 w-3" />
                        Reset password
                      </button>
                    ) : (
                      <button
                        onClick={() => resetPin(s.id)}
                        className="flex-1 inline-flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md bg-card border border-border hover:bg-muted"
                      >
                        <KeyRound className="h-3 w-3" />
                        Reset PIN
                      </button>
                    )}
                    {extra.find((x) => x.id === s.id) && (
                      <button
                        onClick={() => setExtra((p) => p.filter((x) => x.id !== s.id))}
                        className="px-2 py-1.5 rounded-md bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/20"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                    {isStoreStaff && s.role !== "director" && (
                      <button
                        onClick={() => {
                          if (confirm(`Remove ${s.name}?`)) {
                            removeStaff(s.id);
                            toast.success("Staff removed");
                          }
                        }}
                        className="px-2 py-1.5 rounded-md bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/20"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title={`Memos Board (${memos.length})`}>
          <div className="p-5 space-y-3">
            {memos.length === 0 && (
              <div className="text-sm text-muted-foreground">No memos yet.</div>
            )}
            {memos.map((m) => (
              <div key={m.id} className="bg-muted/30 border border-border rounded-lg p-4">
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <div className="font-medium">{m.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.date} · by {m.by}
                    </div>
                  </div>
                  <button
                    onClick={() => setMemos((p) => p.filter((x) => x.id !== m.id))}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <p className="text-sm mt-2 whitespace-pre-wrap">{m.body}</p>
              </div>
            ))}
          </div>
        </Section>
      </main>
      <StaffFormDialog
        open={staffDialog.open}
        editing={staffDialog.editing}
        onOpenChange={(v) => setStaffDialog((p) => ({ ...p, open: v }))}
      />
    </>
  );
}
