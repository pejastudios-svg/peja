"use client";

// The app's switch. Extracted from the Beacon dashboard so every toggle
// looks and behaves identically; a hand-rolled copy elsewhere drifted and
// rendered without its knob.
export function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative w-[50px] h-[30px] rounded-full transition-colors duration-300 shrink-0 ${
        on ? "bg-green-500" : "bg-dark-600"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <span
        className="absolute top-[3px] w-6 h-6 rounded-full bg-white shadow-md"
        style={{
          left: on ? 23 : 3,
          transition: "left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      />
    </button>
  );
}
