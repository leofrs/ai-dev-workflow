import React, { useEffect, useRef } from 'react';

interface ModalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  id?: string;
  ariaLabelledBy?: string;
  className?: string;
  children: React.ReactNode;
}

export const ModalDialog: React.FC<ModalDialogProps> = ({
  isOpen,
  onClose,
  id,
  ariaLabelledBy,
  className = '',
  children
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropPressedRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      id={id}
      aria-labelledby={ariaLabelledBy}
      onClose={() => {
        if (isOpen) {
          onClose();
        }
      }}
      onPointerDown={(event) => {
        backdropPressedRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (backdropPressedRef.current && event.target === event.currentTarget) {
          event.currentTarget.close();
        }
      }}
      className={`app-modal-dialog m-auto overflow-hidden p-0 text-foreground ${className}`}
    >
      {children}
    </dialog>
  );
};
