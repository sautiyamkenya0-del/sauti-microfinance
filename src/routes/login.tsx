import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import logo from "@/assets/sauti-logo.png";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in - Sauti Microfinance" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { loginMember, loginStaff, setAuthenticated, setCurrentUser, staff } = useStore();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [secret, setSecret] = useState("");
  const [showPwd, setShowPwd] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = identifier.trim();
    if (!id || !secret) return toast.error("Enter your details to sign in.");

    if (id.includes("@")) {
      const signedInStaff = loginStaff(id, secret);
      if (!signedInStaff) return toast.error("Invalid email or password.");
      toast.success(`Welcome, ${signedInStaff.name}`);
      router.navigate({ to: "/" });
      return;
    }

    const member = loginMember(id, secret);
    if (member) {
      setAuthenticated(true);
      localStorage.setItem("sauti_portal_v1", member.id);
      toast.success(`Welcome, ${member.name}`);
      router.navigate({ to: "/portal" });
      return;
    }

    toast.error("Membership number or phone do not match. Staff should use work email.");
  };

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(237,189,59,0.18),_transparent_34%),linear-gradient(180deg,_rgba(242,247,238,0.96),_rgba(247,250,245,1))] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[2rem] border border-border/70 bg-card/95 shadow-[0_30px_80px_rgba(37,74,44,0.16)] backdrop-blur lg:grid-cols-[1.05fr_0.95fr]">
          <section className="relative hidden overflow-hidden bg-[linear-gradient(145deg,_rgba(27,79,52,0.98),_rgba(17,53,33,0.96))] p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(237,189,59,0.35),_transparent_26%),radial-gradient(circle_at_bottom_left,_rgba(255,255,255,0.08),_transparent_30%)]" />
            <div className="relative">
              <div className="inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.25em] text-white/80">
                Sauti Business Community
              </div>
              <div className="mt-10 max-w-md">
                <h1 className="font-display text-4xl font-semibold leading-tight">
                  Amplifying the voice of business through one shared platform.
                </h1>
                <p className="mt-4 text-sm leading-6 text-white/78">
                  Manage lending, member operations, savings, and communication from one clean
                  workspace.
                </p>
              </div>
            </div>
            <div className="relative grid gap-4 text-sm text-white/82">
              <div className="rounded-2xl border border-white/12 bg-white/8 p-4">
                Staff sign in with work email and password.
              </div>
              <div className="rounded-2xl border border-white/12 bg-white/8 p-4">
                Members sign in with membership number and phone number on file.
              </div>
            </div>
          </section>

          <section className="flex items-center justify-center p-6 sm:p-8 lg:p-10">
            <div className="w-full max-w-md">
              <div className="mb-8 flex flex-col items-center text-center">
                <img
                  src={logo}
                  alt="Sauti"
                  className="h-20 w-20 rounded-full bg-white/95 p-1.5 ring-1 ring-border shadow-sm"
                />
                <h2 className="mt-4 font-display text-3xl font-semibold text-foreground">
                  Sauti Microfinance
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Sign in after the splash screen to continue.
                </p>
              </div>

              <form onSubmit={submit} className="space-y-4">
                <label className="block">
                  <span className="text-sm font-medium">Membership No. or Email</span>
                  <input
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="SBC0001K or you@sauti.co.ke"
                    className="mt-1.5 w-full rounded-xl border border-border bg-muted px-3 py-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                    autoFocus
                  />
                  <span className="mt-1.5 block text-[11px] text-muted-foreground">
                    Members use their membership number. Staff use their work email.
                  </span>
                </label>

                <label className="block">
                  <span className="text-sm font-medium">Phone Number or Password</span>
                  <div className="relative">
                    <input
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      type={showPwd ? "text" : "password"}
                      placeholder="Members: phone on file. Staff: password."
                      className="mt-1.5 w-full rounded-xl border border-border bg-muted px-3 py-3 pr-11 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(!showPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                    >
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </label>

                <button
                  type="submit"
                  className="mt-2 w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
                >
                  Sign in
                </button>
              </form>

              {staff.length > 0 && (
                <details className="mt-6 rounded-2xl border border-border bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-medium hover:text-foreground">
                    Demo: act as existing staff
                  </summary>
                  <div className="mt-3 space-y-1.5">
                    {staff.map((member) => (
                      <button
                        key={member.id}
                        onClick={() => {
                          setCurrentUser(member);
                          setAuthenticated(true);
                          router.navigate({ to: "/" });
                        }}
                        className="w-full rounded-xl px-3 py-2 text-left text-foreground transition hover:bg-background"
                      >
                        {member.name}{" "}
                        <span className="text-[10px] text-muted-foreground">- {member.role}</span>
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
