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
  const { loginMember, loginStaff } = useStore();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const id = identifier.trim();
    if (!id || !secret) return toast.error("Enter your sign-in details.");

    setSubmitting(true);
    try {
      if (id.includes("@")) {
        const staff = await loginStaff(id, secret);
        if (!staff) return toast.error("Invalid email or password.");
        toast.success(`Welcome, ${staff.name}`);
        await router.navigate({ to: "/" });
        return;
      }

      const result = await loginMember(id, secret);
      if (!result.member) return toast.error("The supplied sign-in details are not valid.");

      toast.success(`Welcome, ${result.member.name}`);
      await router.navigate({ to: result.portal === "supplier" ? "/suppliers" : "/portal" });
    } catch (error: any) {
      toast.error(error?.message ?? "Sign-in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(237,189,59,0.16),_transparent_34%),linear-gradient(180deg,_rgba(242,247,238,0.96),_rgba(247,250,245,1))] px-4 py-6 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl items-center justify-center">
        <div className="w-full max-w-md rounded-[2rem] border border-border/70 bg-card/95 p-8 shadow-[0_30px_80px_rgba(37,74,44,0.16)] backdrop-blur sm:p-10">
          <div className="mb-8 flex flex-col items-center text-center">
            <img
              src={logo}
              alt="Sauti Microfinance"
              className="h-20 w-20 rounded-full bg-white/95 p-1.5 ring-1 ring-border shadow-sm"
            />
            <h1 className="mt-4 font-display text-3xl font-semibold text-foreground">
              Sauti Microfinance
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Secure sign-in for staff, members, investors, and linked suppliers.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium">Email or Membership Number</span>
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="you@sauti.co.ke or SBC0001K"
                className="mt-1.5 w-full rounded-xl border border-border bg-muted px-3 py-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                autoFocus
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Password or Registered Phone Number</span>
              <div className="relative">
                <input
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  type={showSecret ? "text" : "password"}
                  placeholder="Enter your password or phone number"
                  className="mt-1.5 w-full rounded-xl border border-border bg-muted px-3 py-3 pr-11 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                  aria-label={showSecret ? "Hide secret" : "Show secret"}
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
