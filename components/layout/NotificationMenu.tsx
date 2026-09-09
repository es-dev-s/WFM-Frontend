"use client";

import { memo, useCallback, useMemo } from "react";
import { Bell } from "lucide-react";
import { useMenu } from "@/hooks/use-menu";
import { formatBadgeCount } from "@/lib/navigation";
import {
  NOTIFICATIONS,
  type NotificationItem,
  unreadNotificationCount,
} from "@/lib/navbar-data";
import { VirtualList } from "@/components/ui/VirtualList";

type NotificationMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const NOTICE_ROW_HEIGHT = 84;
const NOTICE_VIEWPORT = 276;

function NotificationMenuComponent({
  open,
  onOpenChange,
}: NotificationMenuProps) {
  const { menuId, rootRef } = useMenu({
    open,
    onClose: () => onOpenChange(false),
  });

  const unread = useMemo(() => unreadNotificationCount(NOTIFICATIONS), []);
  const unreadLabel = formatBadgeCount(unread);

  const onSelect = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const renderItem = useCallback(
    (item: NotificationItem) => (
      <button
        type="button"
        className="smp-notice"
        role="menuitem"
        data-unread={item.unread ? "true" : "false"}
        tabIndex={open ? 0 : -1}
        onClick={onSelect}
      >
        <span className="smp-notice__rail" aria-hidden="true">
          <span
            className="smp-notice__pulse"
            data-on={item.unread ? "true" : "false"}
          />
        </span>
        <span className="smp-notice__body">
          <span className="smp-notice__row">
            <span className="smp-notice__title">{item.title}</span>
            <span className="smp-notice__time">{item.time}</span>
          </span>
          <span className="smp-notice__text">{item.body}</span>
        </span>
      </button>
    ),
    [onSelect, open],
  );

  return (
    <div className="smp-menu" ref={rootRef} data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="smp-icon-btn smp-menu__trigger"
        aria-label={
          unreadLabel
            ? `Notifications, ${unreadLabel} unread`
            : "Notifications"
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        data-active={open ? "true" : "false"}
        onClick={() => onOpenChange(!open)}
      >
        <Bell size={16} strokeWidth={1.75} />
        <span
          className="smp-menu__dot"
          data-on={unread > 0 ? "true" : "false"}
          aria-hidden="true"
        />
      </button>

      <div
        id={menuId}
        className="smp-popover smp-popover--notifications"
        role="menu"
        aria-label="Notifications"
        aria-hidden={!open}
      >
        <div className="smp-glass smp-popover__surface">
          <div className="smp-popover__header">
            <div className="smp-popover__heading">
              <span className="smp-popover__title">Notifications</span>
              <span className="smp-popover__meta">
                {unreadLabel ? `${unreadLabel} new` : "You’re caught up"}
              </span>
            </div>
            <button
              type="button"
              className="smp-popover__text-btn"
              data-visible={unread > 0 ? "true" : "false"}
              tabIndex={unread > 0 && open ? 0 : -1}
              aria-hidden={unread <= 0}
            >
              Mark all read
            </button>
          </div>

          {/* Windowed list — ready for high-volume notification streams */}
          <VirtualList
            className="smp-popover__list"
            items={NOTIFICATIONS}
            rowHeight={NOTICE_ROW_HEIGHT}
            height={NOTICE_VIEWPORT}
            active={open}
            getKey={(item) => item.id}
            renderItem={renderItem}
          />

          <div className="smp-popover__footer">
            <button
              type="button"
              className="smp-popover__link-btn"
              tabIndex={open ? 0 : -1}
            >
              View all activity
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const NotificationMenu = memo(NotificationMenuComponent);
