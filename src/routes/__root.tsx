import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  Navigate,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { StoreProvider, useStore } from "@/lib/store";
import { NotificationsProvider } from "@/lib/notifications";
import { AppSidebar } from "@/components/AppSidebar";
import { Toaster } from "@/components/ui/sonner";
import { SplashScreen } from "@/components/SplashScreen";
import { MpesaQueueDrainer } from "@/components/MpesaQueueDrainer";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Sauti Microfinance" },
      {
        name: "description",
        content: "Sauti Microfinance - loans, savings, shares and member management.",
      },
      { property: "og:title", content: "Sauti Microfinance" },
      { name: "twitter:title", content: "Sauti Microfinance" },
      {
        property: "og:description",
        content: "Sauti Microfinance - loans, savings, shares and member management.",
      },
      {
        name: "twitter:description",
        content: "Sauti Microfinance - loans, savings, shares and member management.",
      },
      { property: "og:image", content: "/favicon.png" },
      { name: "twitter:image", content: "/favicon.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/favicon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <StoreProvider>
        <NotificationsProvider>
          <AppLayout />
          <Toaster />
        </NotificationsProvider>
      </StoreProvider>
    </QueryClientProvider>
  );
}

function AppLayout() {
  const { isAuthenticated, isHydrated, authMode } = useStore();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isLoginRoute = pathname === "/login";

  if (!isHydrated) {
    return (
      <div className="min-h-screen bg-background">
        <SplashScreen />
      </div>
    );
  }

  if (!isAuthenticated && !isLoginRoute) {
    return (
      <>
        <SplashScreen />
        <Navigate to="/login" replace />
      </>
    );
  }

  if (isLoginRoute) {
    if (isAuthenticated) {
      return <Navigate to={authMode === "member" ? "/portal" : "/"} replace />;
    }

    return (
      <div className="min-h-screen bg-background">
        <SplashScreen />
        <Outlet />
      </div>
    );
  }

  if (authMode === "member") {
    if (pathname !== "/portal") {
      return <Navigate to="/portal" replace />;
    }

    return (
      <div className="min-h-screen bg-background">
        <SplashScreen />
        <MpesaQueueDrainer />
        <Outlet />
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-screen w-full bg-background">
      <SplashScreen />
      <MpesaQueueDrainer />
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
