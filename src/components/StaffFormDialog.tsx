import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, User as UserIcon, Eye, EyeOff, Fingerprint } from "lucide-react";
import { useStore, type Role, type Staff } from "@/lib/store";
import { getErrorMessage } from "@/lib/utils";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: Staff;
};

export function StaffFormDialog({ open, onOpenChange, editing }: Props) {
  const { addStaff, updateStaff } = useStore();

  const [photo, setPhoto] = useState<string | undefined>(editing?.photo);
  const [firstName, setFirstName] = useState(
    editing?.firstName ?? editing?.name?.split(" ")[0] ?? "",
  );
  const [secondName, setSecondName] = useState(
    editing?.secondName ?? editing?.name?.split(" ")[1] ?? "",
  );
  const [thirdName, setThirdName] = useState(
    editing?.thirdName ?? editing?.name?.split(" ").slice(2).join(" ") ?? "",
  );
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [nationalId, setNationalId] = useState(editing?.nationalId ?? "");
  const [address, setAddress] = useState(editing?.address ?? "");
  const [role, setRole] = useState<Role>(editing?.role ?? "loan_officer");
  const [tempPassword, setTempPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [enrolFp, setEnrolFp] = useState(false);
  const [canMarkAttendance, setCanMarkAttendance] = useState(editing?.canMarkAttendance ?? false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPhoto(editing?.photo);
    setFirstName(editing?.firstName ?? editing?.name?.split(" ")[0] ?? "");
    setSecondName(editing?.secondName ?? editing?.name?.split(" ")[1] ?? "");
    setThirdName(editing?.thirdName ?? editing?.name?.split(" ").slice(2).join(" ") ?? "");
    setPhone(editing?.phone ?? "");
    setEmail(editing?.email ?? "");
    setNationalId(editing?.nationalId ?? "");
    setAddress(editing?.address ?? "");
    setRole(editing?.role ?? "loan_officer");
    setTempPassword("");
    setShowPwd(false);
    setNotes(editing?.notes ?? "");
    setEnrolFp(false);
    setCanMarkAttendance(editing?.canMarkAttendance ?? false);
  }, [editing, open]);

  function onPhoto(file: File) {
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function submit() {
    const name = [firstName, secondName, thirdName].filter(Boolean).join(" ").trim();
    if (!firstName.trim()) return toast.error("First name is required");
    if (!email.trim()) return toast.error("Email is required");
    if (!editing && tempPassword.length < 6) {
      return toast.error("Temporary password must be at least 6 characters");
    }
    if (editing && tempPassword && tempPassword.length < 6) {
      return toast.error("New temporary password must be at least 6 characters");
    }

    const payload = {
      name,
      firstName,
      secondName,
      thirdName,
      role,
      email: email.trim(),
      phone,
      nationalId,
      address,
      notes,
      photo,
      tempPassword: tempPassword.trim() || undefined,
      canMarkAttendance: role === "director" ? true : canMarkAttendance,
      fingerprintEnrolled: enrolFp || editing?.fingerprintEnrolled,
    };

    try {
      if (editing) {
        await updateStaff(editing.id, payload);
        toast.success("Staff updated");
      } else {
        const id = await addStaff(payload);
        toast.success(`Staff created - ${id}`);
      }
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to save staff member"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit staff member" : "Add a new staff member"}</DialogTitle>
          <DialogDescription>
            The account is created instantly with the role you choose. They can sign in straight
            away with the temporary password you assign here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 rounded-full border border-primary/30 bg-primary/10 grid place-items-center overflow-hidden shrink-0">
              {photo ? (
                <img src={photo} alt="" className="h-full w-full object-cover" />
              ) : (
                <UserIcon className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-primary/40 text-sm font-medium hover:bg-primary/5"
              >
                <Upload className="h-4 w-4" />
                Upload / take photo
              </button>
              <p className="text-xs text-muted-foreground mt-1">
                JPEG / PNG. Phone camera works too.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onPhoto(e.target.files[0])}
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="First name" required>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Jane"
                className={inputCls}
              />
            </Field>
            <Field label="Second name">
              <input
                value={secondName}
                onChange={(e) => setSecondName(e.target.value)}
                placeholder="Wanjiru"
                className={inputCls}
              />
            </Field>
            <Field label="Third name">
              <input
                value={thirdName}
                onChange={(e) => setThirdName(e.target.value)}
                placeholder="Mwangi"
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Phone">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07XX XXX XXX"
              className={inputCls}
            />
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Email" required>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@goldenauto.co.ke"
                className={inputCls}
              />
            </Field>
            <Field label="National ID">
              <input
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                placeholder="ID number"
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Address">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Estate / town"
              className={inputCls}
            />
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Role" required>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className={inputCls}
              >
                <option value="loan_officer">Loan Officer</option>
                <option value="manager">Manager</option>
                <option value="director">Director</option>
              </select>
            </Field>
            <Field label={editing ? "New temporary password" : "Temporary password"} required={!editing}>
              <div className="relative">
                <input
                  type={showPwd ? "text" : "password"}
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                  placeholder={editing ? "Leave blank to keep the current password" : ">= 6 characters"}
                  className={inputCls + " pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((state) => !state)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything useful - shift, languages, emergency contact"
              className={inputCls + " resize-y"}
            />
          </Field>

          {role !== "director" && (
            <label className="flex items-center gap-2 text-sm border border-border rounded-md p-3 bg-muted/30">
              <Checkbox
                checked={canMarkAttendance}
                onCheckedChange={(value) => setCanMarkAttendance(!!value)}
              />
              <span>Can mark attendance for other staff (for example at reception)</span>
            </label>
          )}

          <label className="flex items-start gap-3 text-sm border border-border rounded-md p-3 bg-muted/30">
            <Checkbox
              checked={enrolFp}
              onCheckedChange={(value) => setEnrolFp(!!value)}
              className="mt-0.5"
            />
            <div className="flex items-start gap-2">
              <Fingerprint className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                <div>Enrol fingerprint on this device after creating</div>
                <div className="text-xs text-muted-foreground">
                  Tick this if the new staff member is here now and you are using their device.
                </div>
              </div>
            </div>
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border mt-2">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-md border border-border text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
          >
            {editing ? "Save changes" : "Create user"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const inputCls =
  "w-full bg-muted border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {children}
    </div>
  );
}
