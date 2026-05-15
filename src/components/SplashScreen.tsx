import { useEffect, useState } from "react";
import logo from "@/assets/sauti-logo.png";

export function SplashScreen() {
  const [shown, setShown] = useState(true);
  const [fade, setFade] = useState(false);
  useEffect(() => {
    const seen = sessionStorage.getItem("sauti_splash");
    if (seen) {
      setShown(false);
      return;
    }
    const t1 = setTimeout(() => setFade(true), 1600);
    const t2 = setTimeout(() => {
      setShown(false);
      sessionStorage.setItem("sauti_splash", "1");
    }, 2200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  if (!shown) return null;
  return (
    <div
      className={`fixed inset-0 z-[100] grid place-items-center bg-background transition-opacity duration-500 ${fade ? "opacity-0" : "opacity-100"}`}
    >
      <div className="flex flex-col items-center gap-4 animate-in fade-in zoom-in duration-700">
        <img
          src={logo}
          alt="Sauti"
          className="h-24 w-24 rounded-full ring-2 ring-primary/40 animate-pulse"
        />
        <div className="font-display text-2xl font-semibold tracking-tight">Sauti Microfinance</div>
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          Amplifying the Voice of Business
        </div>
        <div className="mt-2 h-1 w-40 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 bg-primary animate-[loader_1.6s_ease-in-out_infinite]" />
        </div>
      </div>
      <style>{`@keyframes loader { 0%{transform:translateX(-100%)} 100%{transform:translateX(400%)} }`}</style>
    </div>
  );
}
