import type { LucideIcon } from "lucide-react";
import {
  CircleHelp,
  LogOut,
  Settings,
  Shield,
  UserRound,
} from "lucide-react";

export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  time: string;
  unread: boolean;
};

export type ProfileAction = {
  id: string;
  label: string;
  description?: string;
  href?: string;
  icon: LucideIcon;
  tone?: "default" | "danger";
};

export const CURRENT_USER = {
  name: "Ava Rajan",
  role: "Head of School",
  email: "ava.rajan@schola.edu",
  initials: "AR",
};

export const NOTIFICATIONS: NotificationItem[] = [
  {
    id: "n1",
    title: "Attendance exception",
    body: "3 students in Grade 8-B need review before 4:00 PM.",
    time: "12m",
    unread: true,
  },
  {
    id: "n2",
    title: "Fee reminder queued",
    body: "Parent notices for March invoices are ready to send.",
    time: "1h",
    unread: true,
  },
  {
    id: "n3",
    title: "Staff meeting",
    body: "Curriculum sync moved to Thursday, 9:30 AM.",
    time: "Yesterday",
    unread: false,
  },
];

export const PROFILE_ACTIONS: ProfileAction[] = [
  {
    id: "profile",
    label: "View profile",
    description: "Name, role, and contact",
    href: "/settings",
    icon: UserRound,
  },
  {
    id: "account",
    label: "Account settings",
    description: "Security and preferences",
    href: "/settings",
    icon: Settings,
  },
  {
    id: "privacy",
    label: "Privacy & access",
    description: "Roles and permissions",
    href: "/settings",
    icon: Shield,
  },
  {
    id: "help",
    label: "Help & support",
    description: "Guides and campus helpdesk",
    href: "/settings",
    icon: CircleHelp,
  },
];

export const LOGOUT_ACTION: ProfileAction = {
  id: "logout",
  label: "Log out",
  description: "Sign out of Schola",
  icon: LogOut,
  tone: "danger",
};

export function unreadNotificationCount(
  items: readonly NotificationItem[] = NOTIFICATIONS,
) {
  let unread = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].unread) unread += 1;
  }
  return unread;
}
