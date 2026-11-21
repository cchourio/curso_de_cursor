export const NAV_ITEMS = [
  { href: "/", label: "Flags" },
  { href: "/companies", label: "Empresas" },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
