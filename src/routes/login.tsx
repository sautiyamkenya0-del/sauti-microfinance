import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import logo from "@/assets/sauti-logo.png";
import { Eye, EyeOff } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — Sauti Microfinance" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { loginMember, loginStaff, setCurrentUser, staff } = useStore();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [secret, setSecret] = useState("");
  const [showPwd, setShowPwd] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = identifier.trim();
    if (!id || !secret) return toast.error("Enter your details to sign in.");

    // Staff sign-in: identifier looks like an email
    if (id.includes("@")) {
      const s = loginStaff(id, secret);
      if (!s) return toast.error("Invalid email or password.");
      toast.success(`Welcome, ${s.name}`);
      router.navigate({ to: "/" });
      return;
    }

    // Otherwise treat as a member: membership no. + phone number
    const m = loginMember(id, secret);
    if (m) {
      localStorage.setItem("sauti_portal_v1", m.id);
      toast.success(`Welcome, ${m.name}`);
      router.navigate({ to: "/portal" });
      return;
    }
    toast.error("Membership number / phone don't match. Staff: use your work email.");
  };

  return (
    <div className="min-h-screen w-full grid place-items-center bg-background p-6">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-8 shadow-lg">
        <div className="flex flex-col items-center mb-6">
          <img
            src={logo}
            alt="Sauti"
            className="h-16 w-16 rounded-full bg-white/95 p-1 ring-1 ring-border"
          />
          <h1 className="font-display text-2xl font-semibold mt-3">Sauti Microfinance</h1>
          <p className="text-xs text-muted-foreground mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium">Membership No. or Email</span>
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="SBC0001K  ·  or  you@sauti.co.ke"
              className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
              autoFocus
            />
            <span className="text-[11px] text-muted-foreground">
              Members use their membership number. Staff use their work email.
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Phone Number / Password</span>
            <div className="relative">
              <input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                type={showPwd ? "text" : "password"}
                placeholder="Members: phone on file  ·  Staff: password"
                className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 pr-10 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
          <button
            type="submit"
            className="w-full bg-primary text-primary-foreground rounded-md py-2.5 text-sm font-medium hover:bg-primary/90 mt-2"
          >
            Sign in
          </button>
        </form>

        {staff.length > 0 && (
          <details className="mt-6 text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">
              Demo: act as existing staff
            </summary>
            <div className="mt-2 space-y-1.5">
              {staff.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setCurrentUser(s);
                    router.navigate({ to: "/" });
                  }}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-muted"
                >
                  {s.name} <span className="text-[10px]">· {s.role}</span>
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
