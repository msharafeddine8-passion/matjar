"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Store as StoreIcon,
  Users,
  Tags,
  CreditCard,
  BarChart3,
  Settings,
  ShoppingBag,
  Star,
  ScrollText,
  Truck,
  Receipt,
  BadgeCheck,
  Crown,
  Briefcase,
  Palette,
  PackageOpen,
  TrendingUp,
  MessageSquare,
  HelpCircle,
  GraduationCap,
  Zap,
  FileText,
  Wrench,
  SearchX,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Container } from "@/components/ui/container";
import { canAccess, type AdminAccess } from "@/lib/admin-sections";
import { AdminCommandPalette } from "@/components/admin-command-palette";

const icons = {
  overview: LayoutGrid,
  stores: StoreIcon,
  orders: Receipt,
  market: ShoppingBag,
  delivery: Truck,
  jobs: Briefcase,
  freelance: Palette,
  wholesale: PackageOpen,
  crafts: Wrench,
  leaders: Crown,
  academy: GraduationCap,
  reviews: Star,
  verifications: BadgeCheck,
  messages: MessageSquare,
  questions: HelpCircle,
  subscriptions: CreditCard,
  reports: BarChart3,
  growth: TrendingUp,
  deals: Zap,
  users: Users,
  types: Tags,
  pages: FileText,
  audit: ScrollText,
  settings: Settings,
  demand: SearchX,
} as const;

type NavKey = keyof typeof icons;

// Grouped so the panel stays legible as modules grow (10-year scale): each
// cluster is a labeled column, dividers between. Adding a module = one entry
// here, not a redesign.
const GROUPS: { key: string; items: { key: NavKey; path: string }[] }[] = [
  { key: "general", items: [{ key: "overview", path: "" }] },
  {
    key: "marketplace",
    items: [
      { key: "stores", path: "/stores" },
      { key: "orders", path: "/orders" },
      { key: "market", path: "/market" },
      { key: "delivery", path: "/delivery" },
    ],
  },
  {
    key: "community",
    items: [
      { key: "jobs", path: "/jobs" },
      { key: "freelance", path: "/freelance" },
      { key: "crafts", path: "/crafts" },
      { key: "wholesale", path: "/wholesale" },
      { key: "leaders", path: "/leaders" },
      { key: "academy", path: "/academy" },
    ],
  },
  {
    key: "trust",
    items: [
      { key: "reviews", path: "/reviews" },
      { key: "verifications", path: "/verifications" },
      { key: "messages", path: "/messages" },
      { key: "questions", path: "/questions" },
    ],
  },
  {
    key: "business",
    items: [
      { key: "subscriptions", path: "/subscriptions" },
      { key: "reports", path: "/reports" },
      { key: "growth", path: "/growth" },
      { key: "deals", path: "/deals" },
      { key: "demand", path: "/demand" },
    ],
  },
  {
    key: "system",
    items: [
      { key: "users", path: "/users" },
      { key: "types", path: "/business-types" },
      { key: "pages", path: "/pages" },
      { key: "audit", path: "/audit" },
      { key: "settings", path: "/settings" },
    ],
  },
];

export function AdminNav({
  lang,
  dict,
  access,
}: {
  lang: Locale;
  dict: Dictionary;
  access: AdminAccess;
}) {
  const pathname = usePathname();
  const base = `/${lang}/admin`;
  const groups = dict.admin.navGroups as Record<string, string>;
  // "demand" is a page of the growth section, not a section of its own: it is
  // gated by growth (as its RLS is, 0306) and labelled from its own namespace.
  const sectionOf = (k: NavKey) => (k === "demand" ? "growth" : k);
  const labelOf = (k: NavKey) =>
    k === "demand" ? dict.demand.nav : dict.admin.nav[k];

  // A sub-admin sees only granted sections. 'overview' is always visible; every
  // other item is gated by its section key. Groups with nothing visible drop.
  const visibleGroups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => item.key === "overview" || canAccess(access, sectionOf(item.key)),
    ),
  })).filter((group) => group.items.length > 0);

  // Flat list for the palette — every section the admin may reach, with the
  // group carried along so typing a group name finds its members.
  const searchable = visibleGroups.flatMap((group) =>
    group.items.map((item) => ({
      key: item.key,
      label: labelOf(item.key),
      group: groups[group.key] ?? "",
      href: `${base}${item.path}`,
    })),
  );

  return (
    <div className="border-b border-border bg-background">
      <Container>
        <div className="flex items-start pt-2.5">
          <AdminCommandPalette
            sections={searchable}
            label={dict.admin.jumpTo}
            placeholder={dict.admin.jumpToPlaceholder}
            empty={dict.admin.jumpToEmpty}
          />
        </div>
        {/* Wrapping is a DESKTOP fix. On a 375px screen 23 items in six labelled
            groups wrap into a wall taller than the content below it, so the
            phone keeps the scrolling strip — where a swipe is a normal gesture
            and the palette above is the real shortcut anyway. */}
        <nav className="flex items-stretch gap-x-2 gap-y-3 overflow-x-auto py-2.5 sm:flex-wrap sm:overflow-x-visible">
          {visibleGroups.map((group, gi) => (
            <Fragment key={group.key}>
              {gi > 0 && (
                <div className="w-px shrink-0 self-stretch bg-border" />
              )}
              <div className="flex shrink-0 flex-col gap-1">
                <span className="px-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
                  {groups[group.key]}
                </span>
                <div className="flex gap-1">
                  {group.items.map((item) => {
                    const href = `${base}${item.path}`;
                    const Icon = icons[item.key];
                    const active =
                      item.path === ""
                        ? pathname === base || pathname === `${base}/`
                        : pathname.startsWith(href);
                    return (
                      <Link
                        key={item.key}
                        href={href}
                        className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                          active
                            ? "bg-primary-soft text-primary"
                            : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {labelOf(item.key)}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </Fragment>
          ))}
        </nav>
      </Container>
    </div>
  );
}
