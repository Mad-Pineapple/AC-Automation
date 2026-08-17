import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { Layout } from "@/components/Layout";
import NotFound from "@/pages/not-found";
import SharePage from "@/pages/Share";

import Dashboard from "@/pages/Dashboard";
import BrandList from "@/pages/brands/List";
import LibraryPage from "@/pages/Library";
import NewBrand from "@/pages/brands/New";
import EditBrand from "@/pages/brands/Edit";
import BriefList from "@/pages/briefs/List";
import NewBrief from "@/pages/briefs/New";
import EditBrief from "@/pages/briefs/Edit";
import BriefDetail from "@/pages/briefs/Detail";
import ApproveScreen from "@/pages/briefs/Approve";
import DispatchScreen from "@/pages/briefs/Dispatch";
import CampaignList from "@/pages/campaigns/List";
import NewCampaign from "@/pages/campaigns/New";
import CampaignDetail from "@/pages/campaigns/Detail";
import Performance from "@/pages/Performance";
import TeamPage from "@/pages/team";
import TemplateList from "@/pages/templates/List";
import NewTemplate from "@/pages/templates/New";
import ImportPdf from "@/pages/templates/ImportPdf";
import EditTemplate from "@/pages/templates/Edit";
import KnowledgeList from "@/pages/knowledge/List";
import LearnArtwork from "@/pages/knowledge/Learn";
import KnowledgeGuidelines from "@/pages/knowledge/Guidelines";
import { TemplateRegistry } from "@/components/TemplateRegistry";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
    },
  },
});

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

// Without a real key the app still renders: Clerk simply never finishes
// loading, so Clerk UI stays hidden and permissions come from /api/me (which
// the server resolves via DEV_AUTH_BYPASS in local dev, or 401s read-only).
// The placeholder is a syntactically valid test key so ClerkProvider mounts.
const effectiveClerkPubKey =
  clerkPubKey ?? "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk";
if (!clerkPubKey) {
  console.warn(
    "VITE_CLERK_PUBLISHABLE_KEY is not set — running without sign-in. Set it at build time to enable Clerk auth.",
  );
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.png`,
  },
  // Auckland Council palette: Shore primary, Ocean text, Anther Red danger.
  variables: {
    colorPrimary: "#0073bd",
    colorForeground: "#11263d",
    colorMutedForeground: "#5b6b7c",
    colorDanger: "#de0a2b",
    colorBackground: "#ffffff",
    colorInput: "#ffffff",
    colorInputForeground: "#11263d",
    colorNeutral: "#11263d",
    fontFamily: "'National 2', 'Helvetica Neue', sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white border border-black/5 rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-slate-800 font-bold",
    headerSubtitle: "text-slate-500",
    socialButtonsBlockButtonText: "text-slate-700",
    formFieldLabel: "text-slate-600",
    footerActionLink: "text-[#E58B76] hover:text-[#D47A65]",
    footerActionText: "text-slate-500",
    dividerText: "text-slate-400",
    identityPreviewEditButton: "text-[#E58B76]",
    formFieldSuccessText: "text-green-600",
    alertText: "text-slate-700",
    logoBox: "mb-2",
    logoImage: "w-10 h-10",
    socialButtonsBlockButton: "border-slate-200 bg-white hover:bg-slate-50",
    formButtonPrimary: "bg-[#E58B76] text-white hover:bg-[#D47A65]",
    formFieldInput: "bg-white border-slate-200 text-slate-800",
    footerAction: "border-t border-slate-100",
    dividerLine: "bg-slate-200",
    alert: "border-slate-200 bg-slate-50",
    otpCodeFieldInput: "bg-white border-slate-200 text-slate-800",
    formFieldRow: "gap-4",
    main: "gap-4",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function AppRoutes() {
  return (
    <Layout>
      <TemplateRegistry />
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/templates" component={TemplateList} />
        <Route path="/templates/new" component={NewTemplate} />
        <Route path="/templates/import" component={ImportPdf} />
        <Route path="/templates/:id" component={EditTemplate} />
        <Route path="/knowledge" component={KnowledgeList} />
        <Route path="/knowledge/learn" component={LearnArtwork} />
        <Route path="/knowledge/guidelines" component={KnowledgeGuidelines} />
        <Route path="/library" component={LibraryPage} />
        <Route path="/brands" component={BrandList} />
        <Route path="/brands/new" component={NewBrand} />
        <Route path="/brands/:id" component={EditBrand} />
        <Route path="/briefs" component={BriefList} />
        <Route path="/briefs/new" component={NewBrief} />
        <Route path="/briefs/:id/edit" component={EditBrief} />
        <Route path="/briefs/:id/approve" component={ApproveScreen} />
        <Route path="/briefs/:id/dispatch" component={DispatchScreen} />
        <Route path="/briefs/:id" component={BriefDetail} />
        <Route path="/campaigns" component={CampaignList} />
        <Route path="/campaigns/new" component={NewCampaign} />
        <Route path="/campaigns/:id" component={CampaignDetail} />
        <Route path="/performance" component={Performance} />
        <Route path="/team" component={TeamPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={effectiveClerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to Brand Studio",
          },
        },
        signUp: {
          start: {
            title: "Create your account",
            subtitle: "Get started with Brand Studio",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <ClerkQueryClientCacheInvalidator />
            <Switch>
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              {/* Public stakeholder gallery — outside the authenticated shell. */}
              <Route path="/share/:token" component={SharePage} />
              <Route component={AppRoutes} />
            </Switch>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
