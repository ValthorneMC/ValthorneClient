import * as React from "react";

export type ModalAccent = "gold" | "green" | "red";

const ACCENT_COLORS: Record<ModalAccent, { rgb: string; text: string }> = {
  gold: { rgb: "212, 175, 55", text: "text-[#e8cf7a]" },
  green: { rgb: "34, 197, 94", text: "text-green-300" },
  red: { rgb: "239, 68, 68", text: "text-red-300" },
};

export interface ModalActionConfig {
  label: React.ReactNode;
  onClick: () => void | Promise<void>;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  icon?: React.ReactNode;
  accent?: ModalAccent;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  actions?: ModalActionConfig[];
}

const ACTION_VARIANT_COLORS: Record<NonNullable<ModalActionConfig["variant"]>, string> = {
  primary: ACCENT_COLORS.gold.rgb,
  secondary: "156, 163, 175",
  danger: ACCENT_COLORS.red.rgb,
};

function ModalActionButton({ label, onClick, variant = "primary", disabled }: ModalActionConfig) {
  const rgb = ACTION_VARIANT_COLORS[variant];
  const textClass = variant === "danger" ? "text-red-100" : variant === "secondary" ? "text-gray-200" : "text-[#f5e6b8]";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-6 py-3 rounded-xl border-2 font-semibold transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${textClass}`}
      style={{
        borderColor: `rgba(${rgb}, 0.5)`,
        background: `linear-gradient(135deg, rgba(${rgb}, 0.18) 0%, rgba(0, 0, 0, 0.5) 100%)`,
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: "0 4px 16px 0 rgba(0, 0, 0, 0.4)",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = `linear-gradient(135deg, rgba(${rgb}, 0.3) 0%, rgba(0, 0, 0, 0.6) 100%)`;
        e.currentTarget.style.boxShadow = `0 6px 24px 0 rgba(${rgb}, 0.35)`;
        e.currentTarget.style.borderColor = `rgba(${rgb}, 0.75)`;
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = `linear-gradient(135deg, rgba(${rgb}, 0.18) 0%, rgba(0, 0, 0, 0.5) 100%)`;
        e.currentTarget.style.boxShadow = "0 4px 16px 0 rgba(0, 0, 0, 0.4)";
        e.currentTarget.style.borderColor = `rgba(${rgb}, 0.5)`;
      }}
    >
      {label}
    </button>
  );
}

export function Modal({ open, onClose, icon, accent = "gold", title, description, children, actions }: ModalProps) {
  if (!open) return null;
  const { rgb } = ACCENT_COLORS[accent];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
      style={{
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onClick={(e) => {
        if (onClose && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="rounded-3xl p-10 max-w-md w-full mx-4 animate-slide-up"
        style={{
          background: "linear-gradient(145deg, rgba(17, 13, 8, 0.98) 0%, rgba(10, 10, 10, 0.97) 100%)",
          backdropFilter: "blur(32px)",
          WebkitBackdropFilter: "blur(32px)",
          boxShadow: `0 25px 80px -12px rgba(${rgb}, 0.35), 0 0 0 1px rgba(${rgb}, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.04)`,
          border: `1px solid rgba(${rgb}, 0.3)`,
        }}
      >
        <div className="text-center">
          {icon && (
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 animate-scale-in"
              style={{
                animationDelay: "0.1s",
                animationFillMode: "both",
                background: `radial-gradient(circle, rgba(${rgb}, 0.25) 0%, rgba(${rgb}, 0.08) 100%)`,
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                border: `2px solid rgba(${rgb}, 0.45)`,
                boxShadow: `0 0 30px rgba(${rgb}, 0.3), inset 0 0 20px rgba(${rgb}, 0.1)`,
              }}
            >
              {icon}
            </div>
          )}

          <h3
            className="font-heading text-3xl font-bold text-white mb-3 animate-fade-in-up"
            style={{ animationDelay: "0.2s", animationFillMode: "both" }}
          >
            {title}
          </h3>

          {description && (
            <p
              className="text-white/70 mb-6 leading-relaxed animate-fade-in-up"
              style={{ animationDelay: "0.3s", animationFillMode: "both" }}
            >
              {description}
            </p>
          )}

          {children && (
            <div className="mb-6 animate-fade-in-up" style={{ animationDelay: "0.3s", animationFillMode: "both" }}>
              {children}
            </div>
          )}

          {actions && actions.length > 0 && (
            <div className="flex gap-4 justify-center animate-fade-in-up" style={{ animationDelay: "0.4s", animationFillMode: "both" }}>
              {actions.map((action, i) => (
                <ModalActionButton key={i} {...action} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Modal;
