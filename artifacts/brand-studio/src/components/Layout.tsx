import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Briefcase,
  Palette,
  LogOut,
  Users,
  LogIn,
  Megaphone,
  BarChart3,
  LayoutTemplate,
  Sparkles,
  Plus,
  UploadCloud,
  ImageIcon,
  Images,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useClerk, useUser } from "@clerk/react";
import { useListBrands } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMe } from "@/hooks/use-me";
import { useTheme } from "@/lib/theme";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { user, isSignedIn, isLoaded: clerkLoaded } = useUser();
  const { data: meData, isFetched: meFetched } = useMe();
  const theme = useTheme();
  const isAdmin = meData?.role === "admin";

  // Clerk's client confirms a signed-in user, but the server's /api/me came back
  // empty (401). In dev this happens when the app runs inside the embedded preview
  // iframe: the browser treats it as a third-party context and withholds the Clerk
  // session cookie, so every authenticated request is rejected and editing/uploads
  // silently disappear. Opening the app top-level (its own tab) restores first-party
  // cookies. Never triggers in production (first-party via the Clerk proxy).
  const sessionUnrecognized =
    clerkLoaded && !!isSignedIn && meFetched && meData === null;

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: brands } = useListBrands();

  const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard, show: true },
    { name: "Campaigns", href: "/campaigns", icon: Megaphone, show: true },
    { name: "Briefs", href: "/briefs", icon: Briefcase, show: true },
    { name: "Brands", href: "/brands", icon: Palette, show: true },
    { name: "Library", href: "/library", icon: Images, show: true },
    { name: "Templates", href: "/templates", icon: LayoutTemplate, show: true },
    { name: "Knowledge", href: "/knowledge", icon: Sparkles, show: true },
    { name: "Performance", href: "/performance", icon: BarChart3, show: true },
    { name: "Team", href: "/team", icon: Users, show: isAdmin },
  ].filter((n) => n.show);

  const displayName = user?.firstName
    ? `${user.firstName}${user.lastName ? " " + user.lastName : ""}`
    : user?.emailAddresses?.[0]?.emailAddress ?? "Account";

  const initials = user?.firstName
    ? `${user.firstName[0]}${user.lastName?.[0] ?? ""}`.toUpperCase()
    : displayName[0]?.toUpperCase() ?? "U";

  const isActive = (href: string) =>
    location === href || (href !== "/" && location.startsWith(href));

  const goToLibrary = (brandId: number) => {
    setPickerOpen(false);
    setLocation(`/brands/${brandId}?tab=library`);
  };

  const activeName = navigation.find((n) => isActive(n.href))?.name ?? "Dashboard";

  return (
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      {/* Desktop rail — the platform's spine, skinned by the active brand
          (white-label: colours/logo/name come from ThemeProvider). */}
      <aside
        className="hidden md:flex w-64 shrink-0 flex-col overflow-y-auto text-white"
        style={{ background: "linear-gradient(180deg, var(--rail-from) 0%, var(--rail-to) 100%)" }}
      >
        <Link href="/">
          <div className="flex items-center gap-3 cursor-pointer px-5 pt-6 pb-7">
            {/* Brand mark in its white tile; letter tile until a brand exists */}
            <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-md p-1.5 shrink-0">
              {theme.logoUrl ? (
                <img src={theme.logoUrl} alt={theme.name} className="w-full h-full object-contain" />
              ) : (
                <span className="text-lg font-extrabold" style={{ color: "var(--rail-from)" }}>
                  {theme.name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <span className="flex flex-col leading-tight min-w-0">
              <span className="text-[15px] font-extrabold tracking-tight text-white truncate">{theme.name}</span>
              <span
                className="text-[0.6rem] font-bold tracking-[0.22em] uppercase"
                style={{ color: "var(--rail-accent)" }}
              >
                Brand Studio
              </span>
            </span>
          </div>
        </Link>

        <nav className="flex flex-col gap-1 px-3 flex-1">
          {navigation.map((item) => {
            const active = isActive(item.href);
            return (
              <Link key={item.name} href={item.href}>
                <div
                  className={cn(
                    "relative flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer group",
                    active
                      ? "bg-white/10 text-white ring-1 ring-white/10 shadow-sm"
                      : "text-white/55 hover:text-white hover:bg-white/5",
                  )}
                  data-testid={`nav-${item.name.toLowerCase()}`}
                >
                  {active && (
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full"
                      style={{ backgroundColor: "var(--rail-accent)" }}
                    />
                  )}
                  <item.icon
                    className={cn(
                      "w-[18px] h-[18px] transition-colors",
                      active ? "" : "text-white/45 group-hover:text-white/90",
                    )}
                    style={active ? { color: "var(--rail-accent)" } : undefined}
                  />
                  {item.name}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Brand strapline — from the brand record (AC: te reo first, always) */}
        {theme.straplineLines.length > 0 && (
          <div className="px-7 py-6 border-t border-white/10 mt-6">
            <p className="text-xs font-bold leading-relaxed text-white/60">
              {theme.straplineLines.map((line, i) => (
                <span key={i}>
                  {i > 0 && <br />}
                  {line}
                </span>
              ))}
            </p>
          </div>
        )}
      </aside>

      {/* Content column */}
      <div className="flex-1 flex flex-col overflow-hidden">
      {/* Slim toolbar: page context left, global actions right */}
      <header className="h-16 shrink-0 sticky top-0 z-20 bg-card/80 backdrop-blur-md border-b border-border flex items-center justify-between gap-4 px-4 md:px-8">
        <Link href="/" className="md:hidden">
          <div className="flex items-center gap-2.5 cursor-pointer">
            <div className="w-9 h-9 rounded-md bg-white border border-border flex items-center justify-center shadow-sm p-1.5">
              {theme.logoUrl ? (
                <img src={theme.logoUrl} alt={theme.name} className="w-full h-full object-contain" />
              ) : (
                <span className="text-sm font-extrabold" style={{ color: "var(--rail-from)" }}>
                  {theme.name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <span className="text-base font-extrabold tracking-tight">Brand Studio</span>
          </div>
        </Link>
        <span className="hidden md:block text-xs font-mono font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {activeName}
        </span>

        <div className="flex items-center gap-2 md:gap-3">
          {isSignedIn ? (
            <>
              <Button
                variant="outline"
                className="rounded-full gap-2 h-10 md:h-11 px-4 md:px-5"
                onClick={() => setPickerOpen(true)}
                data-testid="button-add-asset"
              >
                <UploadCloud className="w-4 h-4 text-primary" />
                <span className="hidden sm:inline">Add asset</span>
              </Button>
              <Link href="/briefs/new">
                <Button
                  className="rounded-full gap-2 h-10 px-4 md:px-6 shadow-md border-0 text-white hover:opacity-90 transition-all"
                  style={{ background: "linear-gradient(90deg, var(--cta-from), var(--cta-to))" }}
                  data-testid="button-new-brief"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">New brief</span>
                </Button>
              </Link>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-3 rounded-full bg-muted/60 hover:bg-muted pl-1.5 pr-2 md:pr-4 py-1.5 transition-colors"
                    data-testid="button-account"
                  >
                    <Avatar className="w-8 h-8 md:w-9 md:h-9 border-2 border-card shadow-sm">
                      <AvatarFallback className="bg-secondary text-secondary-foreground text-xs font-semibold">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="hidden md:flex flex-col items-start leading-none">
                      <span className="text-sm font-semibold truncate max-w-[10rem]">{displayName}</span>
                      <span className="text-xs text-muted-foreground capitalize">{meData?.role ?? "user"}</span>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5">
                    <p className="text-sm font-medium truncate">{displayName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {user?.emailAddresses?.[0]?.emailAddress}
                    </p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => signOut({ redirectUrl: `${basePath}/sign-in` })}
                    className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Link href="/sign-in">
              <Button
                className="rounded-full gap-2 h-10 md:h-11 px-5 md:px-6 shadow-sm"
                data-testid="button-sign-in"
              >
                <LogIn className="w-4 h-4" />
                Sign in
              </Button>
            </Link>
          )}
        </div>
      </header>

      {/* Session-not-reaching-server notice (embedded preview iframe) */}
      {sessionUnrecognized && (
        <div
          className="shrink-0 bg-amber-500/10 border-b border-amber-500/30 px-4 md:px-8 py-3"
          role="alert"
          data-testid="banner-session-unrecognized"
        >
          <div className="flex items-start gap-3 max-w-5xl mx-auto">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                You're signed in, but this preview window can't reach your account
              </p>
              <p className="text-sm text-amber-800/80 dark:text-amber-200/70 mt-0.5">
                Editing, uploads, and admin tools are turned off here. Open the app in a
                full browser tab to continue — you'll stay signed in there.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5 border-amber-500/40 hover:bg-amber-500/10"
              onClick={() => window.open(window.location.href, "_blank", "noopener")}
              aria-label="Open in new tab"
              data-testid="button-open-new-tab"
            >
              <ExternalLink className="w-4 h-4" />
              <span className="hidden sm:inline">Open in new tab</span>
            </Button>
          </div>
        </div>
      )}

      {/* Mobile nav */}
      <nav className="md:hidden shrink-0 border-b border-border bg-card/60 overflow-x-auto">
        <div className="flex gap-1 px-3 py-2 w-max">
          {navigation.map((item) => (
            <Link key={item.name} href={item.href}>
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap cursor-pointer transition-colors",
                  isActive(item.href)
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
                data-testid={`nav-mobile-${item.name.toLowerCase()}`}
              >
                <item.icon className="w-4 h-4" />
                {item.name}
              </div>
            </Link>
          ))}
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-8 max-w-[1440px] mx-auto w-full">{children}</div>
      </main>
      </div>

      {/* Add-asset brand picker */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add assets to a brand</DialogTitle>
            <DialogDescription>
              Pick a brand to open its library, then upload logos or images.
            </DialogDescription>
          </DialogHeader>
          {brands?.length ? (
            <div className="space-y-1 max-h-80 overflow-y-auto -mx-2 px-2">
              {brands.map((b) => (
                <button
                  key={b.id}
                  onClick={() => goToLibrary(b.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted text-left transition-colors"
                  data-testid={`picker-brand-${b.id}`}
                >
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
                    {b.logoUrl ? (
                      <img
                        src={b.logoUrl}
                        alt={b.name}
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <ImageIcon className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <span className="text-sm font-medium">{b.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground mb-4">
                You don't have any brands yet. Create one to start a library.
              </p>
              <Link href="/brands/new">
                <Button onClick={() => setPickerOpen(false)} className="rounded-full gap-2">
                  <Plus className="w-4 h-4" />
                  New brand
                </Button>
              </Link>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
