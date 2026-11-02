export type NavigationSection =
  "search" | "meetings" | "bodies" | "districts" | "submitters" | "saved";

export interface NavigationItem {
  section: NavigationSection;
  label: string;
  path: string;
}

export const primaryNavigation: NavigationItem[] = [
  // Home is the one search-and-browse page; this keeps it in the main menu.
  {
    section: "search",
    label: "Vorlagen",
    path: "",
  },
  {
    section: "meetings",
    label: "Sitzungen",
    path: "sitzungen",
  },
  {
    section: "bodies",
    label: "Gremien",
    path: "gremien",
  },
  {
    section: "districts",
    label: "Stadtteile",
    path: "stadtteile",
  },
  {
    section: "submitters",
    label: "Fraktionen",
    path: "fraktionen",
  },
];

export const utilityNavigation: NavigationItem[] = [
  {
    section: "saved",
    label: "Gespeichert",
    path: "gespeicherte-suchen",
  },
];
