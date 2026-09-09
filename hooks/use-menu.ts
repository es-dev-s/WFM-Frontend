"use client";

import { useCallback, useEffect, useId, useRef } from "react";

type UseMenuOptions = {
  open: boolean;
  onClose: () => void;
};

/** Escape + click-outside. Passive listeners only while open — no page block. */
export function useMenu({ open, onClose }: UseMenuOptions) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const handleClose = useCallback(() => {
    onCloseRef.current();
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && !root.contains(event.target)) {
        handleClose();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, handleClose]);

  return { menuId, rootRef };
}
