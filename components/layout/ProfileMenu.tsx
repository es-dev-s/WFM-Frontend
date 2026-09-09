"use client";

import { memo } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useMenu } from "@/hooks/use-menu";
import {
  CURRENT_USER,
  LOGOUT_ACTION,
  PROFILE_ACTIONS,
} from "@/lib/navbar-data";

type ProfileMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function ProfileMenuComponent({ open, onOpenChange }: ProfileMenuProps) {
  const { menuId, rootRef } = useMenu({
    open,
    onClose: () => onOpenChange(false),
  });

  return (
    <div className="smp-menu" ref={rootRef} data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="smp-navbar__user"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        data-open={open ? "true" : "false"}
        onClick={() => onOpenChange(!open)}
      >
        <span className="smp-navbar__avatar" aria-hidden="true">
          {CURRENT_USER.initials}
        </span>
        <span className="smp-navbar__user-copy">
          <span className="smp-navbar__user-name">{CURRENT_USER.name}</span>
          <span className="smp-navbar__user-role">{CURRENT_USER.role}</span>
        </span>
        <span className="smp-navbar__user-chevron" aria-hidden="true">
          <ChevronDown strokeWidth={1.75} />
        </span>
      </button>

      <div
        id={menuId}
        className="smp-popover smp-popover--profile"
        role="menu"
        aria-label="Account"
        aria-hidden={!open}
      >
        <div className="smp-glass smp-popover__surface">
          <div className="smp-popover__profile">
            <span
              className="smp-navbar__avatar smp-popover__avatar"
              aria-hidden="true"
            >
              {CURRENT_USER.initials}
            </span>
            <div className="smp-popover__profile-copy">
              <span className="smp-popover__profile-name">{CURRENT_USER.name}</span>
              <span className="smp-popover__profile-email">{CURRENT_USER.email}</span>
            </div>
          </div>

          <div className="smp-popover__divider" aria-hidden="true" />

          <div className="smp-popover__list smp-popover__list--actions">
            {PROFILE_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.id}
                  href={action.href ?? "/settings"}
                  className="smp-action"
                  role="menuitem"
                  tabIndex={open ? 0 : -1}
                  onClick={() => onOpenChange(false)}
                >
                  <span className="smp-action__icon" aria-hidden="true">
                    <Icon strokeWidth={1.75} />
                  </span>
                  <span className="smp-action__copy">
                    <span className="smp-action__label">{action.label}</span>
                    <span className="smp-action__desc">{action.description}</span>
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="smp-popover__divider" aria-hidden="true" />

          <div className="smp-popover__list smp-popover__list--actions">
            <button
              type="button"
              className="smp-action smp-action--danger"
              role="menuitem"
              tabIndex={open ? 0 : -1}
              onClick={() => onOpenChange(false)}
            >
              <span className="smp-action__icon" aria-hidden="true">
                <LOGOUT_ACTION.icon strokeWidth={1.75} />
              </span>
              <span className="smp-action__copy">
                <span className="smp-action__label">{LOGOUT_ACTION.label}</span>
                <span className="smp-action__desc">{LOGOUT_ACTION.description}</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const ProfileMenu = memo(ProfileMenuComponent);
